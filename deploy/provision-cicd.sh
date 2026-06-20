#!/usr/bin/env bash
# CI/CD identity for GitHub Actions via OIDC — no long-lived AWS keys.
# Creates (idempotently) the GitHub OIDC provider and a least-privilege deploy
# role scoped to one repo + the main branch. Idempotent via beta.env.
#
#   ./provision-cicd.sh <github-owner/repo>     # default: DanielPPPf/stonewell-site
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"

REPO="${1:-DanielPPPf/stonewell-site}"
ROLE_NAME="${PROJECT}-gha-deploy"
OIDC_HOST="token.actions.githubusercontent.com"
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_HOST}"
[ -n "${SITE_BUCKET:-}" ] || { echo "No SITE_BUCKET — run provision-hosting.sh first."; exit 1; }

# ---- 1. GitHub OIDC provider (account-global; create once) ----
if ! aws_ iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  echo "Creating GitHub OIDC provider…"
  aws_ iam create-open-id-connect-provider \
    --url "https://${OIDC_HOST}" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "ffffffffffffffffffffffffffffffffffffffff" >/dev/null
  # GitHub's OIDC is validated against the JWKS, not the thumbprint, but the
  # field is required; AWS ignores it for this provider.
fi
echo "OIDC provider: $OIDC_ARN"

# ---- 2. Deploy role, trust limited to <repo>:ref:refs/heads/main ----
if [ -z "${GHA_ROLE_ARN:-}" ]; then
  echo "Creating deploy role $ROLE_NAME for repo $REPO…"
  TRUST=$(mktemp)
  cat > "$TRUST" <<EOF
{ "Version": "2012-10-17", "Statement": [ {
  "Effect": "Allow",
  "Principal": { "Federated": "${OIDC_ARN}" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "${OIDC_HOST}:aud": "sts.amazonaws.com" },
    "StringLike":   { "${OIDC_HOST}:sub": "repo:${REPO}:ref:refs/heads/main" }
  }
} ] }
EOF
  GHA_ROLE_ARN=$(aws_ iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST" \
    --query 'Role.Arn' --output text)
  rm -f "$TRUST"
  save_state GHA_ROLE_ARN "$GHA_ROLE_ARN"
fi
echo "Deploy role: $GHA_ROLE_ARN"

# ---- 3. Least-privilege inline policy (S3 sync to site bucket + invalidation) ----
POL=$(mktemp)
cat > "$POL" <<EOF
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "ListSiteBucket", "Effect": "Allow", "Action": "s3:ListBucket",
    "Resource": "arn:aws:s3:::${SITE_BUCKET}" },
  { "Sid": "WriteSiteObjects", "Effect": "Allow",
    "Action": ["s3:PutObject","s3:DeleteObject"],
    "Resource": "arn:aws:s3:::${SITE_BUCKET}/*" },
  { "Sid": "InvalidateCDN", "Effect": "Allow", "Action": "cloudfront:CreateInvalidation",
    "Resource": "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${CLOUDFRONT_DIST_ID}" }
] }
EOF
aws_ iam put-role-policy --role-name "$ROLE_NAME" \
  --policy-name "${PROJECT}-deploy" --policy-document "file://$POL"
rm -f "$POL"

echo "CI/CD role ready. Add to GitHub Actions: role-to-assume=${GHA_ROLE_ARN}"
