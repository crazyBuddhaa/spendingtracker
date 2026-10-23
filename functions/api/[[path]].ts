// Cloudflare Pages Function: the /api/auth/start and /api/me routes are handled by server/api.ts.
// Variables: ACCESS_TEAM_DOMAIN and ACCESS_AUD from your Cloudflare Access application.
// Keep the public website open; use Access only on the identity check endpoint.
import { handleApi } from "../../server/api.ts";
import type { Env } from "../../server/bindings.ts";

export const onRequest = (context: { request: Request; env: Env }): Promise<Response> =>
  handleApi(context.request, context.env);
