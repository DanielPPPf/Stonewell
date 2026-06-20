#!/usr/bin/env bash
# Upload the site to S3 and invalidate CloudFront.
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"

if [ -z "${SITE_BUCKET:-}" ]; then echo "Run provision-hosting.sh first."; exit 1; fi

echo "Syncing ${SITE_DIR} -> s3://${SITE_BUCKET}…"
aws_ s3 sync "$SITE_DIR" "s3://${SITE_BUCKET}" --delete \
  --exclude ".DS_Store" --exclude "*/.DS_Store" --exclude "AUTH.md"

if [ -n "${CLOUDFRONT_DIST_ID:-}" ]; then
  echo "Invalidating CloudFront ${CLOUDFRONT_DIST_ID}…"
  aws_ cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DIST_ID" --paths "/*" \
    --query 'Invalidation.Id' --output text
fi
echo "Deployed. https://${CLOUDFRONT_DOMAIN:-<cloudfront-domain>}/"
