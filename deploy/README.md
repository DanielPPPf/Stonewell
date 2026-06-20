# Stonewell Capital Partners — Beta Deployment & Operations Guide

Live beta of the bilingual site with **real Cognito login**, hosted serverless on
AWS and served (after the final DNS change) at **https://www.stonewellcp.com**.

- **AWS account:** `326804803049` — IAM `user/Daniel`
- **Region:** `us-east-1`
- **aws-cli profile used:** `stonewell` (do **not** use the machine's *default* profile — it is a different account, `Danielgoat`)
- **Status:** deployed & verified end-to-end (home over HTTPS, login → portal → logout).

---

## 1. Architecture

```
www.stonewellcp.com (GoDaddy CNAME)
        │
        ▼
   CloudFront ── HTTPS (ACM cert) · OAC · security headers · global CDN
     │   routes:
     │   /  /login.html  /portal.html  /assets/*   → S3 (private, static)
     ▼
   S3 (private bucket, Block Public Access ON — only CloudFront can read via OAC)

   Login flow:  browser → Amazon Cognito User Pool (USER_PASSWORD_AUTH)
                returns JWT → stored in sessionStorage → portal.html validates it
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
| Cognito User Pool | `us-east-1_VfnRYxQ12` |
| Cognito App Client (public, no secret) | `3pv0ppig9kf2611o5u87mnvdmq` |
| CloudFront managed cache policy | `CachingOptimized` (`658327ea-…`) |
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

---

## 5. Runbook

All commands run from `deploy/` and use the `stonewell` aws-cli profile
(the scripts fall back to it automatically when no AWS env vars are set).

**Prereq (one-time):** `aws configure --profile stonewell` (Access Key, Secret,
region `us-east-1`, output `json`). Verify: `aws sts get-caller-identity --profile stonewell`.

### Deploy a content/site update
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
./provision-cognito.sh     # reuses pool/client if already in beta.env
./provision-hosting.sh     # reuses bucket/OAC/distribution if already in beta.env
./provision-acm.sh request # cert + DNS validation record
./provision-acm.sh attach  # attach cert+alias to CloudFront, print final www CNAME
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
- `login.html` / `portal.html` are `noindex`. The portal session guard is **client-side**
  (UX gate) — appropriate for a beta; truly private content would require an
  authenticated backend.

---

## 7. Files

| File | Purpose |
|---|---|
| `00-config.sh` | Shared vars (region, bucket names, domain). Uses env creds if present, else profile `stonewell`. Resource IDs saved to `beta.env`. |
| `provision-cognito.sh` | User Pool + app client; writes `site/assets/auth-config.js`. |
| `provision-hosting.sh` | Private S3 + OAC + CloudFront + bucket policy. |
| `provision-acm.sh` | `request` (cert + validation record) / `attach` (cert+alias to CloudFront). |
| `create-user.sh` | One Cognito user with a permanent password. |
| `sync-users-to-s3.sh` | Cognito users + bcrypt registry → private encrypted S3. |
| `deploy.sh` | Upload site to S3 + CloudFront invalidation. |
| `beta.env` | **Generated**, git-ignored — canonical resource IDs. |
| `users.local.tsv`, `users.json` | **Sensitive**, git-ignored — never commit. |

---

## 8. Cost (order of magnitude, beta traffic)
S3 storage (~3 MB) + a few thousand CloudFront requests + Cognito (free tier covers
small MAU) ≈ **a few cents to low single-digit USD/month**. No idle compute.

---

## 9. Verification (how this was confirmed)
1. `aws sts get-caller-identity --profile stonewell` → account `326804803049`.
2. Both buckets: anonymous `GET` → `403`; users bucket Block Public Access all `true`.
3. Playwright against the CloudFront URL: home loads over HTTPS; login with the beta
   user → redirect to `/portal.html` showing the signed-in email; logout → back to login.
