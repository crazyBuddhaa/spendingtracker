// Local stand-ins for Cloudflare D1, R2 and Access, used by tests and local e2e runs.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrationsDirectory = new URL("../migrations/", import.meta.url);
const migrations = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(new URL(file, migrationsDirectory), "utf8"));

export function createFakeD1(path = ":memory:") {
  const db = new DatabaseSync(path);
  for (const migration of migrations) db.exec(migration);
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values), success: true }),
    run: async () => {
      const info = db.prepare(sql).run(...values);
      return { results: [], success: true, meta: { changes: Number(info.changes) } };
    },
    _execute: () => db.prepare(sql).run(...values),
  });
  return {
    raw: db,
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((item) => {
          item._execute();
          return { results: [], success: true };
        });
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function createFakeR2() {
  const objects = new Map();
  return {
    objects,
    put: async (key, value, options = {}) => {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new TextEncoder().encode(String(value));
      objects.set(key, { bytes, httpMetadata: options.httpMetadata, customMetadata: options.customMetadata });
    },
    get: async (key) => {
      const object = objects.get(key);
      if (!object) return null;
      return { body: new Blob([object.bytes]).stream(), size: object.bytes.byteLength, httpMetadata: object.httpMetadata };
    },
    delete: async (key) => {
      objects.delete(key);
    },
  };
}

const base64Url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Creates an Access-like issuer: signs RS256 tokens and serves its JWKS. */
export async function createFakeAccess(team = "https://example-team.cloudflareaccess.com", aud = "test-aud") {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test-key" };
  const sign = async (claims, kid = "test-key") => {
    const header = base64Url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
    const now = Math.floor(Date.now() / 1000);
    const payload = base64Url(JSON.stringify({ aud: [aud], iss: team, exp: now + 3600, iat: now, ...claims }));
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
  };
  const fetcher = async (url) => {
    if (url !== `${team}/cdn-cgi/access/certs`) return new Response("not found", { status: 404 });
    return Response.json({ keys: [jwk] });
  };
  return { team, aud, sign, fetcher, env: { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } };
}
