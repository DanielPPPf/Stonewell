#!/usr/bin/env bash
# Operational hardening: S3 versioning on the site bucket, CloudFront standard
# logging to a private logs bucket, and a CloudWatch alarm on the 5xx error rate
# (notified via SNS email). Idempotent. Pass an alert email as $1.
#
#   ./provision-observability.sh <alert-email>
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"

ALERT_EMAIL="${1:-}"
LOGS_BUCKET="${PROJECT}-logs-${ACCOUNT_ID}"
[ -n "${SITE_BUCKET:-}" ] || { echo "No SITE_BUCKET — run provision-hosting.sh first."; exit 1; }
[ -n "${CLOUDFRONT_DIST_ID:-}" ] || { echo "No CLOUDFRONT_DIST_ID."; exit 1; }

# ---- 1. Versioning on the site bucket (rollback / accidental delete safety) ----
echo "Enabling versioning on ${SITE_BUCKET}…"
aws_ s3api put-bucket-versioning --bucket "$SITE_BUCKET" \
  --versioning-configuration Status=Enabled

# ---- 2. Private logs bucket (CloudFront standard logging needs ACLs) ----
if ! aws_ s3api head-bucket --bucket "$LOGS_BUCKET" 2>/dev/null; then
  echo "Creating logs bucket ${LOGS_BUCKET}…"
  aws_ s3api create-bucket --bucket "$LOGS_BUCKET" >/dev/null
fi
aws_ s3api put-public-access-block --bucket "$LOGS_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
# CloudFront standard logging delivers via the awslogsdelivery account using ACLs,
# so the bucket must allow ACLs (BucketOwnerPreferred, not Enforced).
aws_ s3api put-bucket-ownership-controls --bucket "$LOGS_BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerPreferred}]'
aws_ s3api put-bucket-acl --bucket "$LOGS_BUCKET" \
  --grant-full-control "id=$(aws_ s3api list-buckets --query 'Owner.ID' --output text)" \
  --grant-write "uri=http://acs.amazonaws.com/groups/s3/LogDelivery" \
  --grant-read-acp "uri=http://acs.amazonaws.com/groups/s3/LogDelivery"
save_state LOGS_BUCKET "$LOGS_BUCKET"

# ---- 3. Turn on CloudFront standard logging ----
echo "Enabling CloudFront logging -> ${LOGS_BUCKET}…"
TMP=$(mktemp -d)
aws_ cloudfront get-distribution-config --id "$CLOUDFRONT_DIST_ID" > "$TMP/full.json"
ETAG=$(python3 -c 'import sys,json;print(json.load(open(sys.argv[1]))["ETag"])' "$TMP/full.json")
python3 - "$TMP/full.json" "$TMP/cfg.json" "${LOGS_BUCKET}.s3.amazonaws.com" <<'PY'
import sys, json
full, out, domain = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = json.load(open(full))["DistributionConfig"]
cfg["Logging"] = {"Enabled": True, "IncludeCookies": False, "Bucket": domain, "Prefix": "cf/"}
json.dump(cfg, open(out, "w"))
PY
aws_ cloudfront update-distribution --id "$CLOUDFRONT_DIST_ID" \
  --distribution-config "file://$TMP/cfg.json" --if-match "$ETAG" >/dev/null
rm -rf "$TMP"

# ---- 4. SNS topic + email subscription ----
TOPIC_ARN=$(aws_ sns create-topic --name "${PROJECT}-alerts" --query 'TopicArn' --output text)
save_state SNS_TOPIC_ARN "$TOPIC_ARN"
if [ -n "$ALERT_EMAIL" ]; then
  echo "Subscribing ${ALERT_EMAIL} (confirm via email)…"
  aws_ sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$ALERT_EMAIL" >/dev/null
fi

# ---- 5. CloudWatch alarm on CloudFront 5xx error rate (metrics are in us-east-1) ----
echo "Creating 5xx alarm…"
aws_ cloudwatch put-metric-alarm \
  --alarm-name "${PROJECT}-cloudfront-5xx" \
  --alarm-description "CloudFront 5xx error rate > 5% for 10 min" \
  --namespace AWS/CloudFront --metric-name 5xxErrorRate --statistic Average \
  --dimensions "Name=DistributionId,Value=${CLOUDFRONT_DIST_ID}" "Name=Region,Value=Global" \
  --period 300 --evaluation-periods 2 --threshold 5 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN"

echo "Observability ready. Logs: s3://${LOGS_BUCKET}/cf/  Alarm: ${PROJECT}-cloudfront-5xx"
[ -z "$ALERT_EMAIL" ] && echo "NOTE: no email passed — alarm has an SNS topic but no subscriber yet."
echo "Topic: $TOPIC_ARN"
