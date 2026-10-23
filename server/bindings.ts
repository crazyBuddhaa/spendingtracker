/** Cloudflare Pages environment variables used by the Access identity endpoint. */
export interface Env {
  /** e.g. https://your-team.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag from the Access application. */
  ACCESS_AUD?: string;
  /** Local development only: honoured on localhost when Access is not configured. */
  DEV_USER_EMAIL?: string;
}
