/* S3 helpers: presigned URLs for the private docs bucket. */
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.DOCS_BUCKET;
const s3 = new S3Client({});

const GET_TTL = 120; // seconds — short-lived, single-view
const PUT_TTL = 300;

export async function presignGet(key, opts = {}) {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: opts.disposition,   // "inline" | 'attachment; filename="…"'
    ResponseContentType: opts.contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: opts.ttl || GET_TTL });
}

import { GetObjectCommand as _Get } from "@aws-sdk/client-s3";
export async function getObjectBytes(key) {
  const r = await s3.send(new _Get({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const c of r.Body) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function putObjectBytes(key, bytes, contentType = "application/pdf") {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: contentType }));
}

export async function presignPut(key, contentType, ttl = PUT_TTL) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: ttl }
  );
}

export { BUCKET, s3 };
