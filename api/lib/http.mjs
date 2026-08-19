/* Shared HTTP helpers for the Stonewell API Lambdas (HTTP API / payload v2). */

const ORIGIN = process.env.CORS_ORIGIN || "https://www.stonewellcp.com";

export const cors = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "vary": "Origin",
};

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...cors },
    body: JSON.stringify(body),
  };
}

export function parseBody(event) {
  if (!event.body) return {};
  let raw = event.body;
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

/* The HTTP API JWT authorizer validates the token and exposes its claims here. */
export function claimsOf(event) {
  return event.requestContext?.authorizer?.jwt?.claims || null;
}

export function subOf(event) {
  const c = claimsOf(event);
  return c ? c.sub : null;
}

export function emailOf(event) {
  const c = claimsOf(event) || {};
  return c.email || c["cognito:username"] || null;
}

/* cognito:groups arrives either as a real array or a stringified one
   (e.g. "[stonewell-staff]" or "stonewell-staff,other") depending on the path. */
export function groupsOf(event) {
  const c = claimsOf(event) || {};
  let g = c["cognito:groups"];
  if (!g) return [];
  if (Array.isArray(g)) return g;
  if (typeof g === "string") {
    return g.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

export function isStaff(event) {
  return groupsOf(event).includes("stonewell-staff");
}
