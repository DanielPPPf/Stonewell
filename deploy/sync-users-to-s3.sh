#!/usr/bin/env bash
# Replicate the beta user registry to a PRIVATE, ENCRYPTED S3 bucket with
# bcrypt-hashed passwords (no plaintext). Also creates the matching Cognito users.
#
# Input: deploy/users.local.tsv  (git-ignored), one user per line:
#        email<TAB>password
#
# NOTE: This S3 registry is a locked-down BACKUP/audit artifact. Cognito remains
# the live authentication source; a static browser app cannot verify bcrypt
# against S3 without a backend.
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"

SRC="${DEPLOY_DIR}/users.local.tsv"
OUT="${DEPLOY_DIR}/users.json"
[ -f "$SRC" ] || { echo "Missing $SRC (lines: email<TAB>password)"; exit 1; }

# ---- private + encrypted users bucket ----
if ! aws_ s3api head-bucket --bucket "$USERS_BUCKET" 2>/dev/null; then
  echo "Creating users bucket $USERS_BUCKET…"
  aws_ s3api create-bucket --bucket "$USERS_BUCKET" >/dev/null
fi
aws_ s3api put-public-access-block --bucket "$USERS_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws_ s3api put-bucket-encryption --bucket "$USERS_BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# ---- bcrypt-hash the registry ----
python3 - "$SRC" "$OUT" <<'PY'
import sys, json, datetime, bcrypt
src, out = sys.argv[1], sys.argv[2]
recs = []
for raw in open(src, encoding="utf-8"):
    line = raw.rstrip("\n")
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    parts = line.split("\t")
    if len(parts) < 2:
        continue
    email, pw = parts[0].strip(), parts[1]
    h = bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode()
    recs.append({"email": email, "password_bcrypt": h,
                 "created": datetime.datetime.utcnow().isoformat() + "Z"})
json.dump({"generated": datetime.datetime.utcnow().isoformat() + "Z", "users": recs},
          open(out, "w"), indent=2)
print(f"Hashed {len(recs)} user(s) -> {out}")
PY

# ---- create matching Cognito users ----
while IFS=$'\t' read -r EMAIL PASS _; do
  [ -z "${EMAIL:-}" ] && continue
  case "$EMAIL" in \#*) continue;; esac
  "${DEPLOY_DIR}/create-user.sh" "$EMAIL" "$PASS" || true
done < "$SRC"

# ---- upload encrypted registry ----
aws_ s3 cp "$OUT" "s3://${USERS_BUCKET}/users.json" --sse AES256
echo "Registry uploaded (private, SSE): s3://${USERS_BUCKET}/users.json"
