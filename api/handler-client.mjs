/* Stonewell client API — routes under /api/* (excluding /api/admin/*).
   The HTTP API JWT authorizer guarantees a valid Cognito ID token; every read is
   scoped to the token's `sub`, so a client can only ever see their own data. */
import { json, subOf, emailOf } from "./lib/http.mjs";
import * as db from "./lib/ddb.mjs";
import { presignGet, getObjectBytes, putObjectBytes } from "./lib/s3.mjs";
import { stampPdf } from "./lib/watermark.mjs";

const strip = (it) => { if (!it) return it; const { PK, SK, ...rest } = it; return rest; };

export const handler = async (event) => {
  const sub = subOf(event);
  if (!sub) return json(401, { error: "unauthorized" });
  const route = event.routeKey || `${event.requestContext?.http?.method} ${event.rawPath}`;

  try {
    switch (route) {
      case "GET /api/me": {
        const p = await db.getProfile(sub);
        return json(200, {
          sub,
          email: emailOf(event),
          greetingName: p?.greetingName || p?.name || "",
          name: p?.name || "",
          memberId: p?.memberId || "",
          partner: p?.partner || null,
          metrics: p?.metrics || null,
        });
      }

      case "GET /api/documents":
        return json(200, { documents: (await db.listDocuments(sub)).map(strip) });

      case "GET /api/calendar":
        return json(200, { events: (await db.listEvents(sub)).map(strip) });

      case "GET /api/documents/{id}/access":
        return accessDocument(event, sub);

      default:
        return json(404, { error: "not_found", route });
    }
  } catch (err) {
    console.error("client handler error", route, err);
    return json(500, { error: "internal_error" });
  }
};

async function accessDocument(event, sub) {
  const docId = event.pathParameters?.id;
  const doc = await db.getDocument(sub, docId);
  if (!doc) return json(404, { error: "document_not_found" });
  if (!doc.s3key) return json(409, { error: "document_not_ready" });

  const profile = await db.getProfile(sub);
  const who = profile?.name || emailOf(event) || sub;
  const member = profile?.memberId ? ` · ${profile.memberId}` : "";
  const label = `${who}${member} · CONFIDENTIAL · ${new Date().toISOString().slice(0, 10)}`;

  // Burn a per-viewer watermark into a fresh derived copy; never serve the original.
  const src = await getObjectBytes(doc.s3key);
  const stamped = await stampPdf(src, label);
  const derivedKey = `derived/${sub}/${docId}/${Date.now()}.pdf`;
  await putObjectBytes(derivedKey, stamped);

  const download = doc.security === "download";
  const safeName = (doc.name || "document").replace(/[^\w.\- ]+/g, "_");
  const url = await presignGet(derivedKey, {
    ttl: 120,
    contentType: "application/pdf",
    disposition: download ? `attachment; filename="${safeName}.pdf"` : "inline",
  });

  // Audit: capture who accessed what, when, from where.
  await db.putLog(sub, {
    actor: "client",
    action: download ? "downloaded" : "viewed",
    doc: doc.name,
    docId,
    ip: event.requestContext?.http?.sourceIp || null,
  });

  return json(200, { mode: download ? "download" : "viewonly", url, name: doc.name });
}
