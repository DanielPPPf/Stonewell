#!/usr/bin/env bash
# Shared configuration for the Stonewell beta deployment.
# Source this from the other deploy scripts:  source "$(dirname "$0")/00-config.sh"
set -euo pipefail

# Credentials: use explicit env vars if already exported (AWS_ACCESS_KEY_ID/SECRET),
# otherwise fall back to a dedicated 'stonewell' aws-cli profile.
if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  unset AWS_PROFILE 2>/dev/null || true
else
  export AWS_PROFILE="stonewell"        # account 326804803049 / user Daniel
fi
export AWS_REGION="us-east-1"
export AWS_DEFAULT_REGION="us-east-1"

ACCOUNT_ID="326804803049"
PROJECT="stonewell-beta"

SITE_BUCKET="stonewell-beta-site-${ACCOUNT_ID}"
USERS_BUCKET="stonewell-beta-users-${ACCOUNT_ID}"

DOMAIN="www.stonewellcp.com"            # beta will be served here (GoDaddy DNS)

SITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../site" && pwd)"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${DEPLOY_DIR}/beta.env"     # generated; holds resource IDs

aws_() { aws --region "$AWS_REGION" "$@"; }   # credentials from env or AWS_PROFILE

# Load previously-saved resource IDs if present
[ -f "$STATE_FILE" ] && source "$STATE_FILE" || true

save_state() {  # save_state KEY VALUE
  touch "$STATE_FILE"
  grep -v "^export ${1}=" "$STATE_FILE" > "${STATE_FILE}.tmp" 2>/dev/null || true
  mv "${STATE_FILE}.tmp" "$STATE_FILE" 2>/dev/null || true
  echo "export ${1}=\"${2}\"" >> "$STATE_FILE"
  export "${1}=${2}"
}
