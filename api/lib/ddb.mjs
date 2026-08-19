/* DynamoDB single-table access for the Stonewell client portal.
   Table layout (PK / SK):
     CLIENT#<sub> / PROFILE              -> profile + metrics
     CLIENT#<sub> / DOC#<docId>          -> document metadata
     CLIENT#<sub> / EVENT#<startUTC>#<id>-> calendar event
     CLIENT#<sub> / LOG#<ts>#<rnd>       -> access-log entry
*/
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.DATA_TABLE;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const pk = (sub) => `CLIENT#${sub}`;

export async function getProfile(sub) {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(sub), SK: "PROFILE" } }));
  return r.Item || null;
}

export async function putProfile(sub, profile) {
  const item = { ...profile, PK: pk(sub), SK: "PROFILE", sub, updatedAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

async function queryPrefix(sub, prefix, opts = {}) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
    ExpressionAttributeValues: { ":pk": pk(sub), ":p": prefix },
    ScanIndexForward: opts.asc !== false,
    Limit: opts.limit,
  }));
  return r.Items || [];
}

/* ---- Documents ---- */
export const listDocuments = (sub) => queryPrefix(sub, "DOC#");
export async function getDocument(sub, docId) {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(sub), SK: `DOC#${docId}` } }));
  return r.Item || null;
}
export async function putDocument(sub, doc) {
  const item = { ...doc, PK: pk(sub), SK: `DOC#${doc.id}`, sub };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

/* ---- Calendar ---- */
export const listEvents = (sub) => queryPrefix(sub, "EVENT#");
export async function putEvent(sub, ev) {
  const item = { ...ev, PK: pk(sub), SK: `EVENT#${ev.start}#${ev.id}`, sub };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}

/* ---- Access log ---- */
export async function putLog(sub, entry) {
  const ts = new Date().toISOString();
  const rnd = Math.random().toString(36).slice(2, 8);
  const item = { ...entry, PK: pk(sub), SK: `LOG#${ts}#${rnd}`, sub, ts };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return item;
}
export const listLog = (sub) => queryPrefix(sub, "LOG#", { asc: false });

/* ---- Admin: list all client PROFILE rows (small scale; scan acceptable) ---- */
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
export async function listClients() {
  const r = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: "SK = :p",
    ExpressionAttributeValues: { ":p": "PROFILE" },
  }));
  return r.Items || [];
}
