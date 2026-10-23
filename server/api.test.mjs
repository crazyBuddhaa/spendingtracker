import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { handleApi } from "./api.ts";
import { clearKeyCache } from "./auth.ts";
import { createFakeAccess } from "./testing.mjs";

describe("Cloudflare Access identity API", () => {
  let access;
  let env;
  let token;

  beforeEach(async () => {
    clearKeyCache();
    access = await createFakeAccess();
    env = { ...access.env };
    token = await access.sign({ email: "Owner@Example.com" });
  });

  const call = (path, init = {}, headers = { "Cf-Access-Jwt-Assertion": token }) =>
    handleApi(new Request(`https://spend.example.com${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }), env, access.fetcher);

  it("returns only the normalized identity for a valid Access token", async () => {
    const response = await call("/api/me");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { email: "owner@example.com" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });

  it("also reads the CF_Authorization cookie", async () => {
    const response = await call("/api/me", {}, { Cookie: `theme=x; CF_Authorization=${token}` });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { email: "owner@example.com" });
  });

  it("rejects missing, tampered, expired, wrong-audience, wrong-issuer, and unknown-key tokens", async () => {
    assert.equal((await call("/api/me", {}, {})).status, 401);
    const [header, , signature] = token.split(".");
    const tampered = `${header}.${Buffer.from(JSON.stringify({ email: "attacker@example.com", aud: [access.aud], iss: access.team, exp: 9e9 })).toString("base64url")}.${signature}`;
    assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": tampered })).status, 401);
    assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": await access.sign({ email: "a@b.c", exp: 1000 }) })).status, 401);
    assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": await access.sign({ email: "a@b.c", aud: ["other"] }) })).status, 401);
    assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": await access.sign({ email: "a@b.c", iss: "https://evil.cloudflareaccess.com" }) })).status, 401);
    assert.equal((await call("/api/me", {}, { "Cf-Access-Jwt-Assertion": await access.sign({ email: "a@b.c" }, "unknown-kid") })).status, 401);
  });

  it("fails closed without Access configuration except for a localhost developer identity", async () => {
    const localEnv = { DEV_USER_EMAIL: "Dev@local" };
    const remote = await handleApi(new Request("https://spend.example.com/api/me"), localEnv);
    assert.equal(remote.status, 503);
    const local = await handleApi(new Request("http://localhost:8788/api/me"), localEnv);
    assert.equal(local.status, 200);
    assert.deepEqual(await local.json(), { email: "dev@local" });
  });

  it("starts the Access login flow without an existing token", async () => {
    const response = await call("/api/auth/start", {}, {});
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("Location"));
    assert.equal(location.origin, access.team);
    assert.equal(location.pathname, "/cdn-cgi/access/login/spend.example.com");
    assert.equal(location.searchParams.get("kid"), access.aud);
    assert.equal(location.searchParams.get("redirect_url"), "/");
  });

  it("does not start Access login when its settings are missing", async () => {
    const response = await handleApi(
      new Request("https://spend.example.com/api/auth/start"),
      {},
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "not_configured");
  });

  it("does not expose any financial-data or storage endpoints", async () => {
    for (const path of [
      "/api/transactions",
      "/api/collections",
      "/api/statements",
      "/api/backups",
      "/api/monthly-storage/account/2026/01/transactions",
      "/api/storage-preferences",
    ]) {
      assert.equal((await call(path)).status, 404, `${path} should not be served`);
    }
    assert.equal((await call("/api/me", { method: "POST" })).status, 404);
  });
});
