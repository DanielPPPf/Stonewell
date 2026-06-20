#!/usr/bin/env bash
# Custom domain for the beta (www.stonewellcp.com via GoDaddy DNS).
#
#   ./provision-acm.sh request   -> request the cert, print the DNS validation
#                                   CNAME to add in GoDaddy, then poll until ISSUED
#   ./provision-acm.sh attach    -> attach the issued cert + alias to CloudFront,
#                                   then print the final CNAME to add in GoDaddy
source "$(dirname "${BASH_SOURCE[0]}")/00-config.sh"
CMD="${1:-request}"

request_cert() {
  if [ -z "${ACM_CERT_ARN:-}" ]; then
    echo "Requesting ACM certificate for ${DOMAIN}…"
    ARN=$(aws_ acm request-certificate \
      --domain-name "$DOMAIN" \
      --validation-method DNS \
      --query 'CertificateArn' --output text)
    save_state ACM_CERT_ARN "$ARN"
    sleep 5
  fi
  echo "Certificate: $ACM_CERT_ARN"
  echo ""
  echo ">>> Add this CNAME in GoDaddy DNS to validate the certificate:"
  aws_ acm describe-certificate --certificate-arn "$ACM_CERT_ARN" \
    --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output table
  echo ""
  echo "Polling until the certificate is ISSUED (Ctrl-C to stop; re-run later)…"
  aws_ acm wait certificate-validated --certificate-arn "$ACM_CERT_ARN" && echo "Certificate ISSUED."
}

attach_domain() {
  [ -n "${ACM_CERT_ARN:-}" ] || { echo "No ACM_CERT_ARN — run 'request' first."; exit 1; }
  [ -n "${CLOUDFRONT_DIST_ID:-}" ] || { echo "No distribution."; exit 1; }
  TMP=$(mktemp -d)
  aws_ cloudfront get-distribution-config --id "$CLOUDFRONT_DIST_ID" > "$TMP/full.json"
  ETAG=$(python3 -c 'import sys,json;print(json.load(open(sys.argv[1]))["ETag"])' "$TMP/full.json")
  python3 - "$TMP/full.json" "$TMP/cfg.json" "$DOMAIN" "$ACM_CERT_ARN" <<'PY'
import sys, json
full, out, domain, arn = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
cfg = json.load(open(full))["DistributionConfig"]
cfg["Aliases"] = {"Quantity": 1, "Items": [domain]}
cfg["ViewerCertificate"] = {
    "ACMCertificateArn": arn,
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021",
}
json.dump(cfg, open(out, "w"))
PY
  aws_ cloudfront update-distribution --id "$CLOUDFRONT_DIST_ID" \
    --distribution-config "file://$TMP/cfg.json" --if-match "$ETAG" >/dev/null
  rm -rf "$TMP"
  echo "Attached ${DOMAIN} to distribution ${CLOUDFRONT_DIST_ID}."
  echo ""
  echo ">>> Final step — add this CNAME in GoDaddy DNS:"
  echo "    Type: CNAME   Name: www   Value: ${CLOUDFRONT_DOMAIN}   TTL: 600"
}

case "$CMD" in
  request) request_cert ;;
  attach)  attach_domain ;;
  *) echo "usage: $0 {request|attach}"; exit 1 ;;
esac
