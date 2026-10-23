export type AccessErrorKind = "signed-out" | "unavailable";

export class AccessError extends Error {
  readonly kind: AccessErrorKind;

  constructor(kind: AccessErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface AccessIdentity {
  email: string;
}

export const accessApi = {
  async me(): Promise<AccessIdentity> {
    let response: Response;
    try {
      response = await fetch("/api/me", {
        credentials: "same-origin",
        redirect: "manual",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new AccessError("unavailable", "Could not check Cloudflare Access on this site.");
    }

    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new AccessError("signed-out", "Sign in with Cloudflare Access to verify your identity.");
    }
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json") && (response.ok || response.status === 404)) {
      throw new AccessError("unavailable", "Cloudflare Access sign-in is not configured on this site.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new AccessError("signed-out", "Sign in with Cloudflare Access to verify your identity.");
    }
    if (!response.ok) {
      throw new AccessError("unavailable", "Cloudflare Access identity verification is unavailable.");
    }

    const body = await response.json() as Partial<AccessIdentity>;
    if (typeof body.email !== "string" || !body.email) {
      throw new AccessError("unavailable", "The Access identity response was invalid.");
    }
    return { email: body.email };
  },

  signInUrl: () => "/api/auth/start",
};
