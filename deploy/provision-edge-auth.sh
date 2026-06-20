#!/usr/bin/env bash
# Lambda@Edge gate for /portal*: verifies the Cognito ID-token cookie at the
# edge before CloudFront serves the (private) portal page. Idempotent via beta.env.
#
#   ./provision-edge-auth.sh          # create/update fn, publish version, wire CloudFront
#
# Lambda@Edge constraints honoured: function lives in us-east-1, no env vars
# (config baked in at build), associated by published VERSION (not $LATEST).
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"

FN_NAME="${PROJECT}-edge-auth"
ROLE_NAME="${PROJECT}-edge-auth-role"
[ -n "${COGNITO_POOL_ID:-}" ]  || { echo "No COGNITO_POOL_ID — run provision-cognito.sh first."; exit 1; }
[ -n "${COGNITO_CLIENT_ID:-}" ] || { echo "No COGNITO_CLIENT_ID."; exit 1; }
[ -n "${CLOUDFRONT_DIST_ID:-}" ] || { echo "No CLOUDFRONT_DIST_ID — run provision-hosting.sh first."; exit 1; }

# ---- 1. IAM role for Lambda@Edge ----
if [ -z "${EDGE_ROLE_ARN:-}" ]; then
  echo "Creating IAM role $ROLE_NAME…"
  TRUST=$(mktemp)
  cat > "$TRUST" <<'EOF'
{ "Version": "2012-10-17", "Statement": [ {
  "Effect": "Allow",
  "Principal": { "Service": ["lambda.amazonaws.com", "edgelambda.amazonaws.com"] },
  "Action": "sts:AssumeRole"
} ] }
EOF
  EDGE_ROLE_ARN=$(aws_ iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST" \
    --query 'Role.Arn' --output text)
  rm -f "$TRUST"
  aws_ iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  save_state EDGE_ROLE_ARN "$EDGE_ROLE_ARN"
  echo "Waiting for role to propagate…"; sleep 12
fi
echo "Edge role: $EDGE_ROLE_ARN"

# ---- 2. Build the zip (bake config into a copy) ----
BUILD=$(mktemp -d)
sed -e "s|__REGION__|${AWS_REGION}|g" \
    -e "s|__USER_POOL_ID__|${COGNITO_POOL_ID}|g" \
    -e "s|__CLIENT_ID__|${COGNITO_CLIENT_ID}|g" \
    "${DEPLOY_DIR}/edge-auth/index.js" > "${BUILD}/index.js"
( cd "$BUILD" && zip -q function.zip index.js )

# ---- 3. Create or update the function (us-east-1) ----
if ! aws_ lambda get-function --function-name "$FN_NAME" >/dev/null 2>&1; then
  echo "Creating Lambda $FN_NAME…"
  aws_ lambda create-function --function-name "$FN_NAME" \
    --runtime nodejs20.x --handler index.handler \
    --role "$EDGE_ROLE_ARN" --timeout 5 --memory-size 128 \
    --zip-file "fileb://${BUILD}/function.zip" >/dev/null
  aws_ lambda wait function-active --function-name "$FN_NAME"
else
  echo "Updating Lambda $FN_NAME code…"
  aws_ lambda update-function-code --function-name "$FN_NAME" \
    --zip-file "fileb://${BUILD}/function.zip" >/dev/null
  aws_ lambda wait function-updated --function-name "$FN_NAME"
fi
rm -rf "$BUILD"

# ---- 4. Publish a version (Lambda@Edge needs a versioned ARN) ----
EDGE_FN_VERSION_ARN=$(aws_ lambda publish-version --function-name "$FN_NAME" \
  --query 'FunctionArn' --output text)
save_state EDGE_FN_VERSION_ARN "$EDGE_FN_VERSION_ARN"
echo "Published: $EDGE_FN_VERSION_ARN"

# ---- 5. Wire an ordered cache behavior /portal* with the viewer-request assoc ----
TMP=$(mktemp -d)
aws_ cloudfront get-distribution-config --id "$CLOUDFRONT_DIST_ID" > "$TMP/full.json"
ETAG=$(python3 -c 'import sys,json;print(json.load(open(sys.argv[1]))["ETag"])' "$TMP/full.json")
python3 - "$TMP/full.json" "$TMP/cfg.json" "$EDGE_FN_VERSION_ARN" <<'PY'
import sys, json, copy
full, out, fn_arn = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = json.load(open(full))["DistributionConfig"]

# Base the new behavior on the DefaultCacheBehavior so every required field is
# present, then override path/cache-policy/edge-association.
behavior = copy.deepcopy(cfg["DefaultCacheBehavior"])
behavior["PathPattern"] = "/portal*"
behavior["CachePolicyId"] = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"            # CachingDisabled
behavior["ResponseHeadersPolicyId"] = "67f7725c-6f97-4210-82d7-5512b31e9d03"  # SecurityHeaders
behavior["LambdaFunctionAssociations"] = {"Quantity": 1, "Items": [
    {"LambdaFunctionARN": fn_arn, "EventType": "viewer-request", "IncludeBody": False}
]}
behavior.pop("ForwardedValues", None)  # not allowed alongside a CachePolicyId

existing = cfg.get("CacheBehaviors", {}).get("Items", [])
items = [b for b in existing if b.get("PathPattern") != "/portal*"]
items.append(behavior)
cfg["CacheBehaviors"] = {"Quantity": len(items), "Items": items}
json.dump(cfg, open(out, "w"))
PY
aws_ cloudfront update-distribution --id "$CLOUDFRONT_DIST_ID" \
  --distribution-config "file://$TMP/cfg.json" --if-match "$ETAG" >/dev/null
rm -rf "$TMP"

echo "Wired /portal* -> Lambda@Edge on $CLOUDFRONT_DIST_ID."
echo "NOTE: CloudFront is replicating the edge function — allow a few minutes."
