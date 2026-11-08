import express, { type NextFunction, type Request, type Response, Router } from "express";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Collections } from "../db.ts";
import { clientIp, hitRateLimit } from "../http.ts";
import type { PushSender } from "../push.ts";
import { mcpConfig } from "./config.ts";
import { createProvider, handleLogin } from "./oauth.ts";
import { registerTools } from "./tools.ts";

/*
 * The MCP connector: lets Claude (claude.ai, the Claude apps and Claude Code) read and save the
 * person's Caliche Balance data. In Claude: Settings > Connectors > Add custom connector, with
 * <app URL>/mcp. Claude registers itself, the person signs in with their username and password,
 * and every tool runs as them (server/mcp/tools.ts). Needs MCP_SECRET; without it the connector
 * answers that it is off and the rest of the app is untouched.
 */

const REGISTRATIONS_PER_HOUR = 20;
// The SDK's own per-address limits stay on. The app trusts the proxy headers on purpose (Vercel
// sets them), which the limiter would otherwise warn about on every request.
const sdkLimit = { validate: { trustProxy: false } };

/** Every path the connector answers; anything else goes on to the app untouched. */
const PATHS = ["/mcp", "/mcp-login", "/authorize", "/token", "/register", "/revoke", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource"];
// Checked by hand: mounting on these paths would strip them from the URL the OAuth router reads.
const isConnectorPath = (path: string) => PATHS.some((p) => path === p || path.startsWith(`${p}/`));

export function mcpRouter(collections: () => Promise<Collections>, push: PushSender | undefined): Router {
  const router = Router();

  // Without a secret the connector is off; say so instead of failing somewhere inside OAuth.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!isConnectorPath(req.path) || mcpConfig.secret) return next();
    res.status(503).type("text").send("The Claude connector is off: set MCP_SECRET (32 characters or more).");
  });

  // Registration is open by design (Claude registers itself), so it is limited per address.
  router.post("/register", async (req, res, next) => {
    try {
      const limit = await hitRateLimit(await collections(), `mcp-register:${clientIp(req)}`, REGISTRATIONS_PER_HOUR, 60 * 60 * 1000);
      if (limit.limited) return res.status(429).json({ error: "too_many_requests", error_description: "Too many requests. Try again later." });
      next();
    } catch (error) {
      next(error);
    }
  });

  const provider = createProvider(collections);
  // Built on the first request: the public URL comes from the environment.
  type Auth = { routes: ReturnType<typeof mcpAuthRouter>; bearer: ReturnType<typeof requireBearerAuth>; mcpUrl: URL };
  let auth: Auth | null = null;
  const setup = (): Auth => {
    if (auth) return auth;
    const baseUrl = new URL(mcpConfig.baseUrl);
    const mcpUrl = new URL("/mcp", baseUrl);
    auth = {
      mcpUrl,
      routes: mcpAuthRouter({
        provider,
        issuerUrl: baseUrl,
        baseUrl,
        resourceServerUrl: mcpUrl,
        resourceName: "Caliche Balance",
        scopesSupported: ["caliche-balance"],
        // Client secrets never expire, so a connector Claude registered keeps working.
        clientRegistrationOptions: { clientSecretExpirySeconds: 0, rateLimit: sdkLimit },
        authorizationOptions: { rateLimit: sdkLimit },
        tokenOptions: { rateLimit: sdkLimit },
        revocationOptions: { rateLimit: sdkLimit },
      }),
      bearer: requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) }),
    };
    return auth;
  };

  // /.well-known metadata, /authorize, /token, /register and /revoke.
  router.use((req, res, next) => (isConnectorPath(req.path) ? setup().routes(req, res, next) : next()));

  router.post("/mcp-login", express.urlencoded({ extended: false }), (req, res, next) => {
    handleLogin(collections, req, res).catch(next);
  });

  const bearer = (req: Request, res: Response, next: NextFunction) => setup().bearer(req, res, next);

  // Stateless: every request gets its own server bound to the caller's account.
  router.post("/mcp", bearer, express.json({ limit: "4mb" }), async (req, res) => {
    const server = new McpServer({ name: "caliche-balance", title: "Caliche Balance", version: "1.0.0" });
    registerTools(server, req.auth, collections, push);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed:", error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });

  router.all("/mcp", bearer, (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  });

  return router;
}
