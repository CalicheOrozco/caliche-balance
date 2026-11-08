/*
 * Settings for the MCP connector (Claude reading and saving Caliche Balance data, see
 * server/mcp/index.ts). Read on each use, so a missing variable only turns the connector off.
 */

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export const mcpConfig = {
  /**
   * Public URL of the app, where Claude finds /mcp. PUBLIC_URL when set; on Vercel the project's
   * production URL, which Vercel provides; locally the dev API.
   */
  get baseUrl(): string {
    if (process.env.PUBLIC_URL) return trimSlash(process.env.PUBLIC_URL);
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    return "http://localhost:3001";
  },

  /** Encrypts the signed sign-in requests. Changing it only cancels sign-ins in progress. */
  get secret(): string | null {
    const value = process.env.MCP_SECRET;
    return value && value.length >= 32 ? value : null;
  },

  /** Only these hosts may receive sign-in codes: Claude's web callback and the loopback Claude Code uses. */
  get allowedRedirectHosts(): string[] {
    return (process.env.MCP_ALLOWED_REDIRECT_HOSTS ?? "claude.ai,claude.com,localhost,127.0.0.1")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean);
  },
};
