#!/usr/bin/env bash
# Provision the production data layer:
#   - DynamoDB single-table  (stonewell-prod-data)  PAY_PER_REQUEST + PITR
#   - Private S3 docs bucket  (stonewell-prod-docs-<acct>)  no public access,
#     versioned, encrypted, TLS-only.
# Idempotent via deploy/beta.env. Safe to re-run.
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"

DATA_TABLE="stonewell-prod-data"
DOCS_BUCKET="stonewell-prod-docs-${ACCOUNT_ID}"

# ---------------------------------------------------------------------------
# 1) DynamoDB single-table
# ---------------------------------------------------------------------------
if aws_ dynamodb describe-table --table-name "$DATA_TABLE" >/dev/null 2>&1; then
  echo "DynamoDB table exists: $DATA_TABLE"
else
  echo "Creating DynamoDB table: $DATA_TABLE…"
  aws_ dynamodb create-table \
    --table-name "$DATA_TABLE" \
    --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
    --sse-specification Enabled=true \
    --tags Key=project,Value="$PROJECT" >/dev/null
  echo "Waiting for table to become ACTIVE…"
  aws_ dynamodb wait table-exists --table-name "$DATA_TABLE"
fi

# Point-in-time recovery (idempotent — describe first to avoid noisy errors)
PITR=$(aws_ dynamodb describe-continuous-backups --table-name "$DATA_TABLE" \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
  --output text 2>/dev/null || echo "DISABLED")
if [ "$PITR" != "ENABLED" ]; then
  echo "Enabling point-in-time recovery…"
  aws_ dynamodb update-continuous-backups --table-name "$DATA_TABLE" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null
fi
save_state DATA_TABLE "$DATA_TABLE"
echo "Data table ready: $DATA_TABLE (PITR=$([ "$PITR" = ENABLED ] && echo on || echo enabled))"

# ---------------------------------------------------------------------------
# 2) Private docs bucket
# ---------------------------------------------------------------------------
if aws_ s3api head-bucket --bucket "$DOCS_BUCKET" >/dev/null 2>&1; then
  echo "Docs bucket exists: $DOCS_BUCKET"
else
  echo "Creating docs bucket: $DOCS_BUCKET…"
  # us-east-1 must NOT pass a LocationConstraint
  aws_ s3api create-bucket --bucket "$DOCS_BUCKET" >/dev/null
fi

echo "Hardening docs bucket…"
aws_ s3api put-public-access-block --bucket "$DOCS_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null

aws_ s3api put-bucket-versioning --bucket "$DOCS_BUCKET" \
  --versioning-configuration Status=Enabled >/dev/null

aws_ s3api put-bucket-encryption --bucket "$DOCS_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}' >/dev/null

# Deny any non-TLS access (belt-and-suspenders; bucket is already private).
aws_ s3api put-bucket-policy --bucket "$DOCS_BUCKET" --policy "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::${DOCS_BUCKET}", "arn:aws:s3:::${DOCS_BUCKET}/*"],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
JSON
)" >/dev/null

save_state DOCS_BUCKET "$DOCS_BUCKET"
echo "Docs bucket ready: $DOCS_BUCKET (private · versioned · encrypted · TLS-only)"

echo
echo "Data layer provisioned."
echo "  DATA_TABLE  = $DATA_TABLE"
echo "  DOCS_BUCKET = $DOCS_BUCKET"
