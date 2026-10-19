// Cloudflare Pages Function: every request under /api/* is handled by server/api.ts.
// Bindings (configure in the Pages project: Settings → Bindings):
//   DB          – D1 database (schema: migrations/0001_init.sql)
//   STATEMENTS  – R2 bucket for original statement files
// Variables: ACCESS_TEAM_DOMAIN, ACCESS_AUD (from your Cloudflare Access application).
import { handleApi } from "../../server/api.ts";
import type { Env } from "../../server/bindings.ts";

export const onRequest = (context: { request: Request; env: Env }): Promise<Response> =>
  handleApi(context.request, context.env);
