import type { Env } from "./bindings.ts";

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
}

type Fetcher = (input: string) => Promise<Response>;

const keyCache = new Map<string, { keys: Jwk[]; expires: number }>();

function base64UrlDecode(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function decodeJson(segment: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as Record<string, unknown>;
  } catch {
    throw new AuthError("Malformed Access token.");
  }
}

function teamOrigin(env: Env): string {
  const raw = (env.ACCESS_TEAM_DOMAIN ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

async function signingKeys(origin: string, fetcher: Fetcher, now: number, forceRefresh = false): Promise<Jwk[]> {
  const cached = keyCache.get(origin);
  if (cached && cached.expires > now && !forceRefresh) return cached.keys;
  const response = await fetcher(`${origin}/cdn-cgi/access/certs`);
  if (!response.ok) throw new AuthError("Could not load Cloudflare Access signing keys.", 503);
  const body = await response.json() as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  keyCache.set(origin, { keys, expires: now + 60 * 60 * 1000 });
  return keys;
}

/**
 * Verifies a Cloudflare Access JWT (RS256) against the team's published keys and the
 * application's AUD tag, and returns the signed-in email.
 */
export async function verifyAccessJwt(token: string, env: Env, fetcher: Fetcher = fetch, now = Date.now()): Promise<string> {
  const origin = teamOrigin(env);
  const audience = (env.ACCESS_AUD ?? "").trim();
  if (!origin || !audience) throw new AuthError("Cloudflare Access is not configured for this API.", 503);

  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Malformed Access token.");
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJson(headerPart);
  const payload = decodeJson(payloadPart);
  if (header.alg !== "RS256") throw new AuthError("Unsupported Access token algorithm.");

  let keys = await signingKeys(origin, fetcher, now);
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    keys = await signingKeys(origin, fetcher, now, true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) throw new AuthError("Access token was signed with an unknown key.");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new AuthError("Access token signature is invalid.");

  const seconds = Math.floor(now / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) throw new AuthError("Access token is for a different application.");
  if (typeof payload.exp !== "number" || payload.exp < seconds - 30) throw new AuthError("Access session has expired. Reload the page to sign in again.");
  if (typeof payload.nbf === "number" && payload.nbf > seconds + 30) throw new AuthError("Access token is not valid yet.");
  if (payload.iss !== origin) throw new AuthError("Access token was issued by a different team.");
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) throw new AuthError("Access token has no email. Use an identity login (email code, Google, etc.), not a service token.", 403);
  return email;
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Resolves the signed-in user for a request, or throws AuthError. Fails closed in production. */
export async function authenticate(request: Request, env: Env, fetcher: Fetcher = fetch, now = Date.now()): Promise<string> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion") ?? cookieValue(request, "CF_Authorization");
  if (teamOrigin(env) && env.ACCESS_AUD) {
    if (!token) throw new AuthError("Sign in through Cloudflare Access to verify your identity.");
    return verifyAccessJwt(token, env, fetcher, now);
  }
  // Without Access configured, only allow an explicit developer identity on a local address.
  const host = new URL(request.url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (local && env.DEV_USER_EMAIL) return env.DEV_USER_EMAIL.trim().toLowerCase();
  throw new AuthError("Cloudflare Access is not configured for this API. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD.", 503);
}

/** Test hook: forget cached signing keys. */
export function clearKeyCache(): void {
  keyCache.clear();
}
