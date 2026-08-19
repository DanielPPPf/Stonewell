#!/usr/bin/env bash
# Provision the production API: two Lambdas (client + admin) behind an API Gateway
# HTTP API with a Cognito JWT authorizer. Least-privilege IAM. Idempotent via beta.env.
#
#   ./provision-api.sh
#
# Front-end gets the API base URL via site/assets/api-config.js (generated here).
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"

[ -n "${COGNITO_POOL_ID:-}" ]   || { echo "No COGNITO_POOL_ID — run provision-cognito.sh"; exit 1; }
[ -n "${COGNITO_CLIENT_ID:-}" ] || { echo "No COGNITO_CLIENT_ID."; exit 1; }
[ -n "${DATA_TABLE:-}" ]        || { echo "No DATA_TABLE — run provision-data.sh"; exit 1; }
[ -n "${DOCS_BUCKET:-}" ]       || { echo "No DOCS_BUCKET — run provision-data.sh"; exit 1; }

API_DIR="$(cd "${DEPLOY_DIR}/../api" && pwd)"
CLIENT_FN="stonewell-prod-api-client"
ADMIN_FN="stonewell-prod-api-admin"
CLIENT_ROLE="stonewell-prod-api-client-role"
ADMIN_ROLE="stonewell-prod-api-admin-role"
API_NAME="stonewell-prod-api"
ORIGIN="https://${DOMAIN}"
TABLE_ARN="arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/${DATA_TABLE}"
DOCS_ARN="arn:aws:s3:::${DOCS_BUCKET}"
POOL_ARN="arn:aws:cognito-idp:${AWS_REGION}:${ACCOUNT_ID}:userpool/${COGNITO_POOL_ID}"
ISSUER="https://cognito-idp.${AWS_REGION}.amazonaws.com/${COGNITO_POOL_ID}"

# ---------------------------------------------------------------------------
# 1) Build the deployment zip (handlers + lib + node_modules)
# ---------------------------------------------------------------------------
echo "Installing API dependencies…"
( cd "$API_DIR" && npm install --omit=dev --no-audit --no-fund --silent )
ZIP="$(mktemp -d)/api.zip"
( cd "$API_DIR" && zip -qr "$ZIP" handler-client.mjs handler-admin.mjs lib node_modules package.json )
echo "Packaged: $(du -h "$ZIP" | cut -f1)"

# ---------------------------------------------------------------------------
# 2) IAM roles (least privilege)
# ---------------------------------------------------------------------------
TRUST=$(mktemp)
cat > "$TRUST" <<'EOF'
{ "Version":"2012-10-17","Statement":[{"Effect":"Allow",
  "Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF

ensure_role() {  # ensure_role ROLE_NAME STATE_KEY POLICY_JSON
  local name="$1" key="$2" policy="$3" arn
  arn=$(aws_ iam get-role --role-name "$name" --query 'Role.Arn' --output text 2>/dev/null || true)
  if [ -z "$arn" ] || [ "$arn" = "None" ]; then
    echo "Creating role $name…"
    arn=$(aws_ iam create-role --role-name "$name" \
      --assume-role-policy-document "file://$TRUST" --query 'Role.Arn' --output text)
    aws_ iam attach-role-policy --role-name "$name" \
      --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    sleep 8
  fi
  aws_ iam put-role-policy --role-name "$name" --policy-name "${name}-inline" \
    --policy-document "$policy" >/dev/null
  save_state "$key" "$arn"
}

CLIENT_POLICY=$(cat <<JSON
{ "Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:Query","dynamodb:PutItem"],"Resource":"${TABLE_ARN}"},
  {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"${DOCS_ARN}/*"}
]}
JSON
)
ADMIN_POLICY=$(cat <<JSON
{ "Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:Query","dynamodb:PutItem","dynamodb:Scan"],"Resource":"${TABLE_ARN}"},
  {"Effect":"Allow","Action":["s3:PutObject"],"Resource":"${DOCS_ARN}/*"},
  {"Effect":"Allow","Action":["cognito-idp:AdminCreateUser","cognito-idp:AdminSetUserPassword","cognito-idp:AdminGetUser"],"Resource":"${POOL_ARN}"}
]}
JSON
)
ensure_role "$CLIENT_ROLE" CLIENT_ROLE_ARN "$CLIENT_POLICY"
ensure_role "$ADMIN_ROLE"  ADMIN_ROLE_ARN  "$ADMIN_POLICY"
rm -f "$TRUST"

# ---------------------------------------------------------------------------
# 3) Lambda functions
# ---------------------------------------------------------------------------
ENV_VARS="Variables={DATA_TABLE=${DATA_TABLE},DOCS_BUCKET=${DOCS_BUCKET},COGNITO_POOL_ID=${COGNITO_POOL_ID},CORS_ORIGIN=${ORIGIN}}"

ensure_fn() {  # ensure_fn FN_NAME HANDLER ROLE_ARN STATE_KEY
  local fn="$1" handler="$2" role="$3" key="$4"
  if aws_ lambda get-function --function-name "$fn" >/dev/null 2>&1; then
    echo "Updating $fn…"
    aws_ lambda update-function-code --function-name "$fn" --zip-file "fileb://$ZIP" >/dev/null
    aws_ lambda wait function-updated --function-name "$fn"
    aws_ lambda update-function-configuration --function-name "$fn" \
      --handler "$handler" --role "$role" --runtime nodejs20.x \
      --timeout 30 --memory-size 512 --environment "$ENV_VARS" >/dev/null
  else
    echo "Creating $fn…"
    aws_ lambda create-function --function-name "$fn" \
      --runtime nodejs20.x --handler "$handler" --role "$role" \
      --timeout 30 --memory-size 512 --environment "$ENV_VARS" \
      --zip-file "fileb://$ZIP" >/dev/null
    aws_ lambda wait function-active --function-name "$fn"
  fi
  local arn; arn=$(aws_ lambda get-function --function-name "$fn" --query 'Configuration.FunctionArn' --output text)
  save_state "$key" "$arn"
}
ensure_fn "$CLIENT_FN" "handler-client.handler" "$CLIENT_ROLE_ARN" CLIENT_FN_ARN
ensure_fn "$ADMIN_FN"  "handler-admin.handler"  "$ADMIN_ROLE_ARN"  ADMIN_FN_ARN

# ---------------------------------------------------------------------------
# 4) HTTP API + JWT authorizer
# ---------------------------------------------------------------------------
if [ -n "${API_ID:-}" ] && aws_ apigatewayv2 get-api --api-id "$API_ID" >/dev/null 2>&1; then
  echo "Reusing HTTP API: $API_ID"
else
  echo "Creating HTTP API: $API_NAME…"
  API_ID=$(aws_ apigatewayv2 create-api --name "$API_NAME" --protocol-type HTTP \
    --query 'ApiId' --output text)
  save_state API_ID "$API_ID"
fi
# CORS (idempotent)
aws_ apigatewayv2 update-api --api-id "$API_ID" \
  --cors-configuration "AllowOrigins=${ORIGIN},AllowMethods=GET,POST,PUT,OPTIONS,AllowHeaders=authorization,content-type,MaxAge=300" >/dev/null

API_ENDPOINT=$(aws_ apigatewayv2 get-api --api-id "$API_ID" --query 'ApiEndpoint' --output text)
save_state API_ENDPOINT "$API_ENDPOINT"

# Authorizer
AUTH_ID=$(aws_ apigatewayv2 get-authorizers --api-id "$API_ID" \
  --query "Items[?Name=='cognito'].AuthorizerId | [0]" --output text 2>/dev/null)
if [ -z "$AUTH_ID" ] || [ "$AUTH_ID" = "None" ]; then
  echo "Creating JWT authorizer…"
  AUTH_ID=$(aws_ apigatewayv2 create-authorizer --api-id "$API_ID" --name cognito \
    --authorizer-type JWT --identity-source '$request.header.Authorization' \
    --jwt-configuration "Audience=${COGNITO_CLIENT_ID},Issuer=${ISSUER}" \
    --query 'AuthorizerId' --output text)
fi
save_state API_AUTH_ID "$AUTH_ID"

# Integrations (one per Lambda)
ensure_integration() {  # ensure_integration FN_ARN STATE_KEY
  local fn_arn="$1" key="$2" uri id
  uri="arn:aws:apigateway:${AWS_REGION}:lambda:path/2015-03-31/functions/${fn_arn}/invocations"
  id=$(aws_ apigatewayv2 get-integrations --api-id "$API_ID" \
    --query "Items[?IntegrationUri=='${fn_arn}'].IntegrationId | [0]" --output text 2>/dev/null)
  if [ -z "$id" ] || [ "$id" = "None" ]; then
    id=$(aws_ apigatewayv2 create-integration --api-id "$API_ID" \
      --integration-type AWS_PROXY --integration-uri "$fn_arn" \
      --payload-format-version 2.0 --integration-method POST \
      --query 'IntegrationId' --output text)
  fi
  save_state "$key" "$id"
}
ensure_integration "$CLIENT_FN_ARN" CLIENT_INTEG_ID
ensure_integration "$ADMIN_FN_ARN"  ADMIN_INTEG_ID

# Routes
EXISTING_ROUTES=$(aws_ apigatewayv2 get-routes --api-id "$API_ID" --query 'Items[].RouteKey' --output text 2>/dev/null || true)
ensure_route() {  # ensure_route "GET /api/me" INTEG_ID
  local rk="$1" integ="$2"
  if echo "$EXISTING_ROUTES" | tr '\t' '\n' | grep -qxF "$rk"; then
    return
  fi
  echo "  + route: $rk"
  aws_ apigatewayv2 create-route --api-id "$API_ID" --route-key "$rk" \
    --target "integrations/${integ}" \
    --authorization-type JWT --authorizer-id "$AUTH_ID" >/dev/null
}
echo "Wiring routes…"
ensure_route "GET /api/me"                              "$CLIENT_INTEG_ID"
ensure_route "GET /api/documents"                       "$CLIENT_INTEG_ID"
ensure_route "GET /api/documents/{id}/access"           "$CLIENT_INTEG_ID"
ensure_route "GET /api/calendar"                        "$CLIENT_INTEG_ID"
ensure_route "GET /api/admin/clients"                   "$ADMIN_INTEG_ID"
ensure_route "POST /api/admin/clients"                  "$ADMIN_INTEG_ID"
ensure_route "POST /api/admin/clients/{sub}/documents"  "$ADMIN_INTEG_ID"
ensure_route "PUT /api/admin/clients/{sub}/metrics"     "$ADMIN_INTEG_ID"
ensure_route "POST /api/admin/clients/{sub}/events"     "$ADMIN_INTEG_ID"

# Stage ($default, auto-deploy)
if ! aws_ apigatewayv2 get-stage --api-id "$API_ID" --stage-name '$default' >/dev/null 2>&1; then
  echo "Creating \$default stage (auto-deploy)…"
  aws_ apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null
fi

# Permission for API Gateway to invoke each Lambda (idempotent)
add_perm() {  # add_perm FN_NAME
  aws_ lambda add-permission --function-name "$1" --statement-id "apigw-invoke" \
    --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${AWS_REGION}:${ACCOUNT_ID}:${API_ID}/*/*" >/dev/null 2>&1 \
    && echo "  granted invoke: $1" || true
}
add_perm "$CLIENT_FN"
add_perm "$ADMIN_FN"

rm -f "$ZIP"

# ---------------------------------------------------------------------------
# 5) Front-end API config
# ---------------------------------------------------------------------------
cat > "${SITE_DIR}/assets/api-config.js" <<EOF
/* Public API base URL — generated by deploy/provision-api.sh. */
window.STONEWELL_API = { base: "${API_ENDPOINT}" };
EOF
echo "Wrote ${SITE_DIR}/assets/api-config.js"

echo
echo "API provisioned."
echo "  API_ENDPOINT = $API_ENDPOINT"
echo "  routes: /api/me /api/documents /api/documents/{id}/access /api/calendar + /api/admin/*"
