#!/usr/bin/env bash
# Create the private S3 site bucket + CloudFront (OAC, HTTPS, security headers).
# Idempotent via deploy/beta.env.
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"

# ---- 1. Private S3 bucket ----
if ! aws_ s3api head-bucket --bucket "$SITE_BUCKET" 2>/dev/null; then
  echo "Creating site bucket $SITE_BUCKET…"
  aws_ s3api create-bucket --bucket "$SITE_BUCKET" >/dev/null   # us-east-1: no LocationConstraint
fi
aws_ s3api put-public-access-block --bucket "$SITE_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# ---- 2. Origin Access Control ----
if [ -z "${OAC_ID:-}" ]; then
  echo "Creating Origin Access Control…"
  OAC_ID=$(aws_ cloudfront create-origin-access-control \
    --origin-access-control-config "Name=${PROJECT}-oac,Description=Stonewell beta,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query 'OriginAccessControl.Id' --output text)
  save_state OAC_ID "$OAC_ID"
fi
echo "OAC: $OAC_ID"

# ---- 3. CloudFront distribution ----
if [ -z "${CLOUDFRONT_DIST_ID:-}" ]; then
  echo "Creating CloudFront distribution…"
  CFG=$(mktemp)
  cat > "$CFG" <<EOF
{
  "CallerReference": "${PROJECT}-$(date +%s)",
  "Comment": "Stonewell Capital Partners — beta",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": { "Quantity": 1, "Items": [ {
    "Id": "s3origin",
    "DomainName": "${SITE_BUCKET}.s3.${AWS_REGION}.amazonaws.com",
    "OriginAccessControlId": "${OAC_ID}",
    "S3OriginConfig": { "OriginAccessIdentity": "" }
  } ] },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "Compress": true,
    "AllowedMethods": { "Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } },
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "ResponseHeadersPolicyId": "67f7725c-6f97-4210-82d7-5512b31e9d03"
  },
  "CustomErrorResponses": { "Quantity": 2, "Items": [
    { "ErrorCode": 403, "ResponseCode": "200", "ResponsePagePath": "/index.html", "ErrorCachingMinTTL": 10 },
    { "ErrorCode": 404, "ResponseCode": "200", "ResponsePagePath": "/index.html", "ErrorCachingMinTTL": 10 }
  ] },
  "PriceClass": "PriceClass_100"
}
EOF
  OUT=$(aws_ cloudfront create-distribution --distribution-config "file://$CFG")
  rm -f "$CFG"
  CLOUDFRONT_DIST_ID=$(echo "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Distribution"]["Id"])')
  CLOUDFRONT_DOMAIN=$(echo "$OUT"  | python3 -c 'import sys,json;print(json.load(sys.stdin)["Distribution"]["DomainName"])')
  save_state CLOUDFRONT_DIST_ID "$CLOUDFRONT_DIST_ID"
  save_state CLOUDFRONT_DOMAIN "$CLOUDFRONT_DOMAIN"
fi
echo "Distribution: $CLOUDFRONT_DIST_ID  ($CLOUDFRONT_DOMAIN)"

# ---- 4. Bucket policy: allow only this distribution (OAC) ----
DIST_ARN="arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${CLOUDFRONT_DIST_ID}"
POL=$(mktemp)
cat > "$POL" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [ {
    "Sid": "AllowCloudFrontServicePrincipal",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${SITE_BUCKET}/*",
    "Condition": { "StringEquals": { "AWS:SourceArn": "${DIST_ARN}" } }
  } ]
}
EOF
aws_ s3api put-bucket-policy --bucket "$SITE_BUCKET" --policy "file://$POL"
rm -f "$POL"

echo "Hosting ready. Beta URL: https://${CLOUDFRONT_DOMAIN}"
