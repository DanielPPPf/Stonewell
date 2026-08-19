/* Stonewell admin API — routes under /api/admin/*. Staff-only: requires the
   stonewell-staff group in the caller's ID token (the edge also gates /admin*). */
import crypto from "node:crypto";
import {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { json, parseBody, isStaff } from "./lib/http.mjs";
import * as db from "./lib/ddb.mjs";
import { presignPut } from "./lib/s3.mjs";

const cog = new CognitoIdentityProviderClient({});
const POOL_ID = process.env.COGNITO_POOL_ID;

const strip = (it) => { if (!it) return it; const { PK, SK, ...rest } = it; return rest; };
const newId = () => crypto.randomUUID();

export const handler = async (event) => {
  if (!isStaff(event)) return json(403, { error: "forbidden" });
  const route = event.routeKey || `${event.requestContext?.http?.method} ${event.rawPath}`;
  const sub = event.pathParameters?.sub;
  const body = parseBody(event);

  try {
    switch (route) {
      case "GET /api/admin/clients":
        return json(200, { clients: (await db.listClients()).map(strip) });

      case "POST /api/admin/clients":
        return createClient(body);

      case "POST /api/admin/clients/{sub}/documents":
        return createDocument(sub, body);

      case "PUT /api/admin/clients/{sub}/metrics":
        return updateProfile(sub, body);

      case "POST /api/admin/clients/{sub}/events":
        return createEvent(sub, body);

      default:
        return json(404, { error: "not_found", route });
    }
  } catch (err) {
    console.error("admin handler error", route, err);
    return json(500, { error: "internal_error", detail: err.name });
  }
};

function genPassword() {
  // Pool policy: min length 8, no character-class requirements.
  return crypto.randomBytes(9).toString("base64url") + "Aa9";
}

async function createClient(body) {
  const email = (body.email || "").trim().toLowerCase();
  if (!email) return json(400, { error: "email_required" });
  const password = body.password || genPassword();

  await cog.send(new AdminCreateUserCommand({
    UserPoolId: POOL_ID,
    Username: email,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
    ],
    MessageAction: "SUPPRESS",
  }));
  await cog.send(new AdminSetUserPasswordCommand({
    UserPoolId: POOL_ID, Username: email, Password: password, Permanent: true,
  }));

  // Resolve the Cognito sub (the portal's primary key for this client).
  const u = await cog.send(new AdminGetUserCommand({ UserPoolId: POOL_ID, Username: email }));
  const subAttr = (u.UserAttributes || []).find((a) => a.Name === "sub");
  const clientSub = subAttr?.Value;

  const profile = await db.putProfile(clientSub, {
    email,
    name: body.name || "",
    greetingName: body.greetingName || body.name || "",
    memberId: body.memberId || "",
    partner: body.partner || null,
    metrics: body.metrics || null,
  });

  // tempPassword returned once so staff can hand it over out-of-band.
  return json(201, { sub: clientSub, email, tempPassword: body.password ? undefined : password, profile: strip(profile) });
}

async function createDocument(sub, body) {
  if (!sub) return json(400, { error: "sub_required" });
  if (!body.name) return json(400, { error: "name_required" });
  const docId = body.id || newId();
  const s3key = `clients/${sub}/${docId}/source.pdf`;
  const contentType = body.contentType || "application/pdf";

  const doc = await db.putDocument(sub, {
    id: docId,
    name: body.name,
    category: body.category || "fund",
    tags: body.tags || [],
    date: body.date || new Date().toISOString().slice(0, 10),
    security: body.security === "download" ? "download" : "viewonly",
    s3key,
    createdAt: new Date().toISOString(),
  });

  const uploadUrl = await presignPut(s3key, contentType);
  return json(201, { docId, s3key, uploadUrl, document: strip(doc) });
}

async function updateProfile(sub, body) {
  if (!sub) return json(400, { error: "sub_required" });
  const existing = (await db.getProfile(sub)) || {};
  const merged = {
    email: existing.email,
    name: body.name ?? existing.name ?? "",
    greetingName: body.greetingName ?? existing.greetingName ?? existing.name ?? "",
    memberId: body.memberId ?? existing.memberId ?? "",
    partner: body.partner ?? existing.partner ?? null,
    metrics: body.metrics ?? existing.metrics ?? null,
  };
  const profile = await db.putProfile(sub, merged);
  return json(200, { profile: strip(profile) });
}

async function createEvent(sub, body) {
  if (!sub) return json(400, { error: "sub_required" });
  if (!body.start || !body.end) return json(400, { error: "start_end_required" });
  const ev = await db.putEvent(sub, {
    id: body.id || newId(),
    title: body.title || "",
    with: body.with || "",
    mode: ["video", "phone", "inperson"].includes(body.mode) ? body.mode : "video",
    location: body.location || "",
    start: body.start,   // ICS UTC stamp, e.g. 20260626T200000Z
    end: body.end,
  });
  return json(201, { event: strip(ev) });
}
