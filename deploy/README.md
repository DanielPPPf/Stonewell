# Stonewell Capital Partners — Beta Deployment & Operations Guide

Live beta of the bilingual site with **real Cognito login + mandatory TOTP MFA**
and an **edge-enforced portal**, hosted serverless on AWS and served at
**https://www.stonewellcp.com**.

- **AWS account:** `326804803049` — IAM `user/Daniel`
- **Region:** `us-east-1`
- **aws-cli profile used:** `stonewell` (do **not** use the machine's *default* profile — it is a different account, `Danielgoat`)
- **Status:** deployed & verified end-to-end (home over HTTPS; login → TOTP enroll/challenge → portal → logout; `/portal*` 302s without a valid token cookie).

### What's hardened beyond the first beta
- **MFA:** TOTP is **mandatory** (`MfaConfiguration=ON`). First sign-in enrolls a
  software token (QR + secret); later sign-ins require the 6-digit code.
- **Portal gate:** a **Lambda@Edge** viewer-request function verifies the Cognito
  ID-token **signature** (JWKS) on `/portal*` before CloudFront serves it. The old
  client-side check remains only as a UX fallback.
- **Domain:** apex `stonewellcp.com` forwards (301) to `www` via GoDaddy.
- **CI/CD:** GitHub Actions deploys via **OIDC** (no long-lived AWS keys).
- **Ops:** S3 versioning, CloudFront access logs, and a 5xx CloudWatch alarm.

---

## 1. Architecture

```
stonewellcp.com ──301 (GoDaddy forwarding)──▶ www.stonewellcp.com (GoDaddy CNAME)
                                                       │
                                                       ▼
   CloudFront ── HTTPS (ACM cert) · OAC · security headers · access logs · CDN
     │
     │  default behavior:  /  /login.html  /assets/*  /robots.txt … → S3
     │
     │  /portal*  ── viewer-request ▶ Lambda@Edge (verify Cognito JWT signature)
     │                 valid → S3   |   invalid/absent → 302 /login.html
     ▼
   S3 (private bucket, Block Public Access ON — only CloudFront can read via OAC)

   Login flow:  browser → Cognito (USER_PASSWORD_AUTH) → MANDATORY TOTP MFA
                → ID token (JWT) → sessionStorage + Secure cookie `stonewell_idt`
                The cookie is what the edge function checks on /portal*.
```

Static frontend + managed auth (**serverless / JAMstack**). No servers to run or
patch. Scales with traffic via the CDN. This base composes with a future API
(API Gateway+Lambda or EC2) **additively** — the static layer does not change.

---

## 2. Provisioned resources (recorded — live values also in `deploy/beta.env`)

| Resource | Identifier |
|---|---|
| Site bucket (private, OAC) | `stonewell-beta-site-326804803049` |
| Users registry bucket (private, SSE-AES256) | `stonewell-beta-users-326804803049` |
| Origin Access Control | `E28GDVZN6UP01Y` |
| CloudFront distribution | `E2I1YCYTQL2V4` |
| CloudFront domain (always-on) | `d286xzk5ky12xi.cloudfront.net` |
| ACM certificate (ISSUED) | `…:certificate/729cb519-5176-4337-8d3a-e19372b8da77` |
| Cognito User Pool (MFA = ON, TOTP) | `us-east-1_VfnRYxQ12` |
| Cognito App Client (public, no secret) | `3pv0ppig9kf2611o5u87mnvdmq` |
| Lambda@Edge function (portal gate) | `stonewell-beta-edge-auth:2` |
| Lambda@Edge role | `stonewell-beta-edge-auth-role` |
| GitHub Actions deploy role (OIDC) | `stonewell-beta-gha-deploy` |
| GitHub OIDC provider | `token.actions.githubusercontent.com` |
| Logs bucket (private) | `stonewell-beta-logs-326804803049` |
| SNS alerts topic | `stonewell-beta-alerts` |
| CloudWatch alarm | `stonewell-beta-cloudfront-5xx` |
| CloudFront managed cache policies | `CachingOptimized` (`658327ea-…`), `CachingDisabled` (`4135ea2d-…`, on `/portal*`) |
| CloudFront managed response-headers policy | `SecurityHeaders` (`67f7725c-…`) |

Public Cognito IDs are embedded in `site/assets/auth-config.js` (safe — not secrets).

---

## 3. URLs & access

| | |
|---|---|
| Beta (always-on) | https://d286xzk5ky12xi.cloudfront.net |
| Beta (custom domain) | https://www.stonewellcp.com — active once the `www` CNAME points to CloudFront |
| Login page | `/login.html` → on success redirects to `/portal.html` |
| Beta user | `danielpf.spotify@gmail.com` (password set out-of-band) |

---

## 4. DNS records (GoDaddy — zone `stonewellcp.com`)

| Purpose | Type | Name (host) | Value |
|---|---|---|---|
| ACM validation (keep permanently) | CNAME | `_0256652f4c130c221e4aae3ce57a7349.www` | `_c34cdd410b9c050a0646d98b879267e2.jkddzztszm.acm-validations.aws` |
| Serve the site | CNAME | `www` | `d286xzk5ky12xi.cloudfront.net` |

GoDaddy appends `.stonewellcp.com` to the host automatically; no trailing dot.

**Apex redirect (GoDaddy *Domain Forwarding*, not a DNS record):**
GoDaddy → *Domain Settings* → **Forwarding** → *Add* →
forward `stonewellcp.com` to `https://www.stonewellcp.com`, type **Permanent (301)**,
**Forward only** (no masking). This is why the apex resolves to the `www` site
without needing an ACM cert on the apex or a CloudFront alias for it.

---

## 5. Runbook

All commands run from `deploy/` and use the `stonewell` aws-cli profile
(the scripts fall back to it automatically when no AWS env vars are set).

**Prereq (one-time):** `aws configure --profile stonewell` (Access Key, Secret,
region `us-east-1`, output `json`). Verify: `aws sts get-caller-identity --profile stonewell`.

### Deploy a content/site update
**Primary path = CI/CD:** push to `main` (any change under `site/**`) and the
GitHub Actions workflow (`.github/workflows/deploy.yml`) assumes the OIDC role and
runs the sync + invalidation — no local keys.

```bash
git add -A && git commit -m "…" && git push   # triggers Deploy site workflow
```

**Manual fallback** (uses the `stonewell` profile):
```bash
./deploy.sh          # aws s3 sync site/ → bucket (--delete) + CloudFront invalidation
```

### Add a beta user
```bash
./create-user.sh someone@example.com 'StrongPass123'         # Cognito only
# …or batch + bcrypt registry backup:
#   edit deploy/users.local.tsv  (email<TAB>password, git-ignored)
./sync-users-to-s3.sh                                        # needs conda 'base' python (bcrypt)
```
> `sync-users-to-s3.sh` needs the `bcrypt` lib. Run it with conda `base` active and
> the conda AWS env vars unset, so it uses the profile:
> `conda activate base && unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY && ./sync-users-to-s3.sh`

### Re-provision (idempotent — safe to re-run)
```bash
./provision-cognito.sh                 # pool/client + enforce TOTP MFA (ON)
./provision-hosting.sh                 # bucket/OAC/distribution
./provision-acm.sh request|attach      # cert + DNS validation / attach cert+alias
./provision-edge-auth.sh               # build+publish Lambda@Edge, wire /portal* behavior
./provision-cicd.sh OWNER/REPO         # GitHub OIDC provider + least-priv deploy role
./provision-observability.sh EMAIL     # versioning + CF logging + SNS + 5xx alarm
```
> After `provision-edge-auth.sh` (or any distribution change) CloudFront shows
> `InProgress` for a few minutes while the edge function replicates globally.

### Reset a user's MFA (e.g. lost authenticator)
```bash
aws cognito-idp admin-set-user-mfa-preference --profile stonewell \
  --user-pool-id us-east-1_VfnRYxQ12 --username <email> \
  --software-token-mfa-settings Enabled=false,PreferredMfa=false
# next sign-in re-enters TOTP enrollment (shows a fresh QR)
```

---

## 6. Security notes

- **Rotate the IAM access key** (`AKIAUYFYVRXUR3RL7OX5`): it was shared via screenshot
  and is therefore exposed. Create a new key in IAM, update the `stonewell` profile,
  deactivate/delete the old one.
- **Buckets are private.** Block Public Access is ON for both; anonymous `GET` returns
  `403`. The site is reachable **only** through CloudFront (OAC). Verify:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://stonewell-beta-site-326804803049.s3.amazonaws.com/index.html   # 403
  ```
- **Users registry (`users.json`)** holds bcrypt hashes only (no plaintext), in a
  private + encrypted bucket. It is a **backup/registry**, *not* the live auth source —
  Cognito verifies credentials. A static browser app cannot check bcrypt against S3
  without a backend.
- **TLS** via ACM (auto-renews). HSTS + `X-Content-Type-Options` + `Referrer-Policy` +
  `X-Frame-Options` come from the CloudFront managed SecurityHeaders policy.
- **MFA is mandatory** (`MfaConfiguration=ON`, software token). No user can complete
  sign-in without enrolling/passing TOTP.
- **Portal is gated at the edge.** A Lambda@Edge viewer-request function on `/portal*`
  verifies the Cognito ID-token **signature** against the pool JWKS (and `iss`/`aud`/
  `exp`/`token_use`). Without a valid token cookie it returns `302 /login.html`, so the
  portal HTML is never served to anonymous/forged requests. Verify:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://www.stonewellcp.com/portal.html        # 302
  curl -s -o /dev/null -w "%{http_code}\n" --cookie "stonewell_idt=x.y.z" \
       https://www.stonewellcp.com/portal.html                                            # 302
  ```
- **Token cookie caveat:** `stonewell_idt` is set by JS (not `HttpOnly`) so the edge can
  read it; since the edge verifies the **signature**, a forged cookie is rejected. The
  residual risk is XSS-based theft, mitigated by the SecurityHeaders policy. The legacy
  client-side check in `portal.js` is now only a UX fallback behind the edge gate.
- `login.html` / `portal.html` are `noindex`; `robots.txt` also disallows them.
- **CI/CD uses OIDC**, not stored keys — the `stonewell-beta-gha-deploy` role is
  assumable only from `repo:DanielPPPf/stonewell-site:ref:refs/heads/main` and limited
  to S3 sync + CloudFront invalidation.

---

## 7. Files

| File | Purpose |
|---|---|
| `00-config.sh` | Shared vars (region, bucket names, domain). Uses env creds if present, else profile `stonewell`. Resource IDs saved to `beta.env`. |
| `provision-cognito.sh` | User Pool + app client; **enforces TOTP MFA**; writes `site/assets/auth-config.js`. |
| `provision-hosting.sh` | Private S3 + OAC + CloudFront + bucket policy. |
| `provision-acm.sh` | `request` (cert + validation record) / `attach` (cert+alias to CloudFront). |
| `provision-edge-auth.sh` | Build/publish the Lambda@Edge gate + wire the `/portal*` behavior. |
| `edge-auth/index.js` | The edge function (zero-deps JWT verify); `__PLACEHOLDERS__` baked at build. |
| `provision-cicd.sh` | GitHub OIDC provider + least-privilege deploy role. |
| `provision-observability.sh` | S3 versioning + CloudFront logging + SNS topic + 5xx alarm. |
| `create-user.sh` | One Cognito user with a permanent password. |
| `sync-users-to-s3.sh` | Cognito users + bcrypt registry → private encrypted S3. |
| `deploy.sh` | Manual upload to S3 + CloudFront invalidation (fallback to CI/CD). |
| `../.github/workflows/deploy.yml` | CI/CD: OIDC deploy on push to `main` (`site/**`). |
| `beta.env` | **Generated**, git-ignored — canonical resource IDs. |
| `users.local.tsv`, `users.json` | **Sensitive**, git-ignored — never commit. |

---

## 8. Cost (order of magnitude, beta traffic)
S3 storage (~3 MB) + a few thousand CloudFront requests + Cognito (free tier covers
small MAU) ≈ **a few cents to low single-digit USD/month**. No idle compute.

---

## 9. Verification (how this was confirmed)
1. `aws sts get-caller-identity --profile stonewell` → account `326804803049`.
2. Buckets private: anonymous `GET` → `403`; site reachable only via CloudFront.
3. **MFA (Playwright + RFC-6238 TOTP):** first sign-in shows the QR + secret, verifies
   the 6-digit code, lands on `/portal.html`; a second sign-in shows the TOTP challenge.
4. **Edge gate (live):** `/portal.html` with no cookie → `302 /login.html`; with a
   garbage cookie → `302`; after a real login (valid signed cookie) → `200` even on a
   hard reload. Home `/` stays `200` (not gated).
5. **SEO:** `/robots.txt` → `200 text/plain`, `/sitemap.xml` → `200 application/xml`.
6. **Ops:** site bucket versioning `Enabled`; CloudFront logging `Enabled` → `logs`
   bucket; alarm `stonewell-beta-cloudfront-5xx` created.

## 10. Pending (user actions)
- **GitHub repo:** create `DanielPPPf/stonewell-site` (private) and push `main` so the
  Actions workflow runs. (The OIDC role and workflow file are already in place.)
- **Alarm email:** `./provision-observability.sh you@example.com` (or subscribe an
  endpoint to the `stonewell-beta-alerts` SNS topic) and confirm the subscription.
- **Rotate the IAM admin key** (`AKIA…7OX5`) when the key owner is available.
