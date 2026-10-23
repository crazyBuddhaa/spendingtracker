import { AuthError, authenticate } from "./auth.ts";
import type { Env } from "./bindings.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function startAccessLogin(request: Request, env: Env): Response {
  const rawDomain = (env.ACCESS_TEAM_DOMAIN ?? "").trim().replace(/\/+$/, "");
  const audience = (env.ACCESS_AUD ?? "").trim();
  if (!rawDomain || !audience) {
    return json(
      { error: "Cloudflare Access is not configured for this API. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD.", code: "not_configured" },
      503,
    );
  }

  const domain = /^https?:\/\//i.test(rawDomain) ? rawDomain : `https://${rawDomain}`;
  const returnUrl = new URL("/", request.url);
  const loginUrl = new URL(`/cdn-cgi/access/login/${returnUrl.hostname}`, domain);
  loginUrl.searchParams.set("kid", audience);
  loginUrl.searchParams.set("redirect_url", returnUrl.pathname + returnUrl.search);
  return new Response(null, {
    status: 302,
    headers: { Location: loginUrl.toString(), "Cache-Control": "no-store" },
  });
}

/** Serves only the Access login redirect and the authenticated identity endpoint. */
export async function handleApi(
  request: Request,
  env: Env,
  fetcher?: (input: string) => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method.toUpperCase();

  if (path === "/api/auth/start" && method === "GET") return startAccessLogin(request, env);
  if (path !== "/api/me" || method !== "GET") {
    return json({ error: "Not found.", code: "not_found" }, 404);
  }

  try {
    const email = await authenticate(request, env, fetcher);
    return json({ email });
  } catch (error) {
    if (error instanceof AuthError) {
      return json({ error: error.message, code: error.status === 503 ? "not_configured" : "unauthorized" }, error.status);
    }
    console.error("Spendwise Access API error", error);
    return json({ error: "Something went wrong on the server.", code: "server_error" }, 500);
  }
}
