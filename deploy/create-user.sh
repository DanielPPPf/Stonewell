#!/usr/bin/env bash
# Create a single Cognito beta user with a permanent password (no email invite).
#   ./create-user.sh <email> <password>
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"

EMAIL="${1:-}"; PASS="${2:-}"
if [ -z "$EMAIL" ] || [ -z "$PASS" ]; then
  echo "usage: $0 <email> <password>"; exit 1
fi
if [ -z "${COGNITO_POOL_ID:-}" ]; then
  echo "No COGNITO_POOL_ID — run provision-cognito.sh first."; exit 1
fi

aws_ cognito-idp admin-create-user \
  --user-pool-id "$COGNITO_POOL_ID" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS >/dev/null 2>&1 || echo "(user may already exist — continuing)"

aws_ cognito-idp admin-set-user-password \
  --user-pool-id "$COGNITO_POOL_ID" \
  --username "$EMAIL" \
  --password "$PASS" --permanent

echo "Beta user ready: $EMAIL"
