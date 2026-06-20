"use strict";
/* =====================================================
   Stonewell — Lambda@Edge viewer-request gate for /portal*
   -----------------------------------------------------
   Verifies the Cognito ID token (RS256) against the pool's
   JWKS using Node's built-in crypto — ZERO dependencies, to
   stay well under the Lambda@Edge size limit. The token is
   read from the `stonewell_idt` cookie (set by login.js).
   Valid  -> request passes through to S3.
   Invalid/absent -> 302 redirect to /login.html.

   Placeholders (__REGION__ etc.) are substituted at build time
   by deploy/provision-edge-auth.sh (Lambda@Edge has no env vars).
   ===================================================== */
const https = require("https");
const crypto = require("crypto");

const REGION = "__REGION__";
const USER_POOL_ID = "__USER_POOL_ID__";
const CLIENT_ID = "__CLIENT_ID__";

const ISSUER = "https://cognito-idp." + REGION + ".amazonaws.com/" + USER_POOL_ID;
const JWKS_URL = ISSUER + "/.well-known/jwks.json";
const COOKIE_NAME = "stonewell_idt";
const LOGIN_PATH = "/login.html";

let jwksCache = null; // { kid: jwk } cached across warm invocations

function fetchJwks() {
  if (jwksCache) return Promise.resolve(jwksCache);
  return new Promise((resolve, reject) => {
    https.get(JWKS_URL, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          const keys = {};
          JSON.parse(body).keys.forEach((k) => { keys[k.kid] = k; });
          jwksCache = keys;
          resolve(keys);
        } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function b64urlToBuf(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

async function verify(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  let header, payload;
  try {
    header = JSON.parse(b64urlToBuf(h).toString("utf8"));
    payload = JSON.parse(b64urlToBuf(p).toString("utf8"));
  } catch (e) { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;

  const keys = await fetchJwks();
  const jwk = keys[header.kid];
  if (!jwk) return null;

  const pubKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const v = crypto.createVerify("RSA-SHA256");
  v.update(h + "." + p);
  if (!v.verify(pubKey, b64urlToBuf(sig))) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now >= payload.exp) return null;
  if (payload.iss !== ISSUER) return null;
  if (payload.token_use !== "id") return null;
  if (payload.aud !== CLIENT_ID) return null;
  return payload;
}

function getCookie(headers, name) {
  const c = headers.cookie;
  if (!c) return null;
  for (const h of c) {
    for (const part of h.value.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
    }
  }
  return null;
}

function redirect() {
  return {
    status: "302",
    statusDescription: "Found",
    headers: {
      location: [{ key: "Location", value: LOGIN_PATH }],
      "cache-control": [{ key: "Cache-Control", value: "no-store" }],
    },
  };
}

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const token = getCookie(request.headers, COOKIE_NAME);
  if (!token) return redirect();
  try {
    const claims = await verify(token);
    if (!claims) return redirect();
  } catch (e) {
    return redirect();
  }
  return request; // authorized
};
