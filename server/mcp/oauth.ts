import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { hashSecret, verifyPassword } from "../auth.ts";
import type { Collections, OAuthTokenDoc } from "../db.ts";
import { clientIp, hitRateLimit, peekRateLimit } from "../http.ts";
import { mcpConfig } from "./config.ts";
import { decrypt, encrypt, randomToken } from "./crypto.ts";
import { LOGIN_ERRORS, pageLang, renderLogin, sendPage } from "./loginPage.ts";

/*
 * OAuth for the MCP connector, the way Claude expects it: Claude registers itself (Dynamic Client
 * Registration), opens the sign-in page, gets a code and trades it for tokens, with PKCE. Tokens
 * are stored only as hashes and point straight at the person's account. Access tokens last an hour;
 * refresh tokens last 30 days and rotate on every use. Changing the password ends every connector.
 */

const ACCESS_TTL = 60 * 60 * 1000;
const REFRESH_TTL = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL = 5 * 60 * 1000;
const SIGN_IN_TTL = 10 * 60 * 1000;
const CLIENT_TTL = 90 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_ATTEMPTS = 10;
const TRUSTED_HOSTS = ["claude.ai", "claude.com"];

/** What the sign-in form carries, encrypted so the browser can neither read nor change it. */
interface SignInRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

function secretOrThrow(): string {
  const secret = mcpConfig.secret;
  if (!secret) throw new Error("MCP_SECRET is not set (32 characters or more)");
  return secret;
}

function redirectAllowed(uri: string): boolean {
  try {
    const url = new URL(uri);
    const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
    // Loopback only over http(s), so a custom scheme cannot hand the code to another app.
    if (loopback ? !["http:", "https:"].includes(url.protocol) : url.protocol !== "https:") return false;
    return mcpConfig.allowedRedirectHosts.includes(url.hostname);
  } catch {
    return false;
  }
}

/** The name a client registers is chosen by whoever registers it, so it is only trusted when the sign-in returns to Claude. */
function displayName(client: OAuthClientInformationFull, redirectUri: string, lang: "es" | "en"): string {
  const host = new URL(redirectUri).hostname;
  const trusted = TRUSTED_HOSTS.some((name) => host === name || host.endsWith(`.${name}`));
  if (trusted) return "Claude";
  return `${client.client_name || (lang === "es" ? "Una app" : "An app")} (${lang === "es" ? "sin verificar" : "not verified"})`;
}

export function createProvider(collections: () => Promise<Collections>): OAuthServerProvider {
  async function issueTokens(input: Pick<OAuthTokenDoc, "clientId" | "userId" | "scopes" | "resource"> & { family?: string }): Promise<OAuthTokens> {
    const c = await collections();
    const now = Date.now();
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const shared = { clientId: input.clientId, userId: input.userId, scopes: input.scopes, resource: input.resource, family: input.family ?? randomToken() };
    await c.oauthTokens.insertMany([
      { ...shared, kind: "access", hash: hashSecret(accessToken), expiresAt: new Date(now + ACCESS_TTL) },
      { ...shared, kind: "refresh", hash: hashSecret(refreshToken), expiresAt: new Date(now + REFRESH_TTL) },
    ]);
    return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refreshToken, scope: input.scopes.join(" ") };
  }

  /** Every token from one sign-in shares a family, so revoking (or a reused refresh token) ends all of them. */
  async function endFamily(doc: OAuthTokenDoc) {
    const c = await collections();
    await c.oauthTokens.deleteMany({ family: doc.family });
  }

  return {
    clientsStore: {
      async getClient(clientId: string) {
        const c = await collections();
        const doc = await c.oauthClients.findOneAndUpdate(
          { client_id: clientId },
          { $set: { expiresAt: new Date(Date.now() + CLIENT_TTL) } },
          { returnDocument: "after", projection: { _id: 0, createdAt: 0, expiresAt: 0 } },
        );
        return (doc ?? undefined) as OAuthClientInformationFull | undefined;
      },
      // Only redirect hosts we trust may register, so a stranger cannot create a client that sends sign-in codes to their own site.
      async registerClient(client) {
        const uris = client.redirect_uris ?? [];
        if (!uris.length || !uris.every((u) => redirectAllowed(String(u)))) {
          throw new InvalidClientMetadataError(`redirect_uris must use one of: ${mcpConfig.allowedRedirectHosts.join(", ")}`);
        }
        const full = client as OAuthClientInformationFull;
        const c = await collections();
        await c.oauthClients.insertOne({ ...full, redirect_uris: uris.map(String), createdAt: new Date(), expiresAt: new Date(Date.now() + CLIENT_TTL) });
        return full;
      },
    },

    async authorize(client, params, res) {
      const lang = pageLang(res.req.get("accept-language"));
      const clientName = displayName(client, params.redirectUri, lang);
      const request = encrypt(
        {
          clientId: client.client_id,
          clientName,
          redirectUri: params.redirectUri,
          codeChallenge: params.codeChallenge,
          state: params.state,
          scopes: params.scopes ?? [],
          resource: params.resource?.href,
          expiresAt: Date.now() + SIGN_IN_TTL,
        } satisfies SignInRequest,
        secretOrThrow(),
      );
      sendPage(res, 200, renderLogin({ lang, request, clientName, redirectHost: new URL(params.redirectUri).host }), lang, params.redirectUri);
    },

    async challengeForAuthorizationCode(client, code) {
      const c = await collections();
      const doc = await c.oauthCodes.findOne({ hash: hashSecret(code), clientId: client.client_id });
      if (!doc || doc.expiresAt < new Date()) throw new InvalidGrantError("Invalid or expired authorization code");
      return doc.codeChallenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
      const c = await collections();
      // Deleting on read makes every code single use.
      const doc = await c.oauthCodes.findOneAndDelete({ hash: hashSecret(code), clientId: client.client_id });
      if (!doc || doc.expiresAt < new Date()) throw new InvalidGrantError("Invalid or expired authorization code");
      if (redirectUri && redirectUri !== doc.redirectUri) throw new InvalidGrantError("redirect_uri does not match");
      return issueTokens({ clientId: client.client_id, userId: doc.userId, scopes: doc.scopes, resource: doc.resource });
    },

    // Refresh tokens rotate. A used one stays marked until it expires, so if it shows up again (a
    // sign it was stolen) the whole family ends.
    async exchangeRefreshToken(client, refreshToken) {
      const c = await collections();
      const hash = hashSecret(refreshToken);
      const doc = await c.oauthTokens.findOneAndUpdate({ hash, kind: "refresh", clientId: client.client_id, used: { $ne: true } }, { $set: { used: true } });
      if (!doc) {
        const reused = await c.oauthTokens.findOne({ hash, kind: "refresh", clientId: client.client_id });
        if (reused) await endFamily(reused);
        throw new InvalidGrantError("Invalid or expired refresh token");
      }
      if (doc.expiresAt < new Date()) throw new InvalidGrantError("Invalid or expired refresh token");
      return issueTokens(doc);
    },

    async verifyAccessToken(token) {
      const c = await collections();
      const doc = await c.oauthTokens.findOne({ hash: hashSecret(token), kind: "access" });
      if (!doc || doc.expiresAt < new Date()) throw new InvalidTokenError("Invalid or expired access token");
      return {
        token,
        clientId: doc.clientId,
        scopes: doc.scopes ?? [],
        expiresAt: Math.floor(doc.expiresAt.getTime() / 1000),
        resource: doc.resource ? new URL(doc.resource) : undefined,
        extra: { userId: doc.userId.toHexString() },
      };
    },

    async revokeToken(client, { token }) {
      const c = await collections();
      const doc = await c.oauthTokens.findOne({ hash: hashSecret(token), clientId: client.client_id });
      if (doc) await endFamily(doc);
    },
  };
}

/** Handles the sign-in form shown by authorize(): checks the password and sends Claude a single-use code. */
export async function handleLogin(collections: () => Promise<Collections>, req: Request, res: Response) {
  const lang = pageLang(req.get("accept-language"));
  const errors = LOGIN_ERRORS[lang];
  let request: SignInRequest;
  try {
    request = decrypt<SignInRequest>(String(req.body.request), secretOrThrow());
  } catch {
    return sendPage(res, 400, renderLogin({ lang, fatal: errors.invalid }), lang);
  }
  if (request.expiresAt < Date.now()) return sendPage(res, 400, renderLogin({ lang, fatal: errors.expired }), lang);

  const back = new URL(request.redirectUri);
  if (request.state) back.searchParams.set("state", request.state);
  if (req.body.action === "deny") {
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("error_description", "The user declined access");
    return res.redirect(302, back.href);
  }

  const username = String(req.body.username ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");
  const show = (status: number, error: string) =>
    sendPage(
      res,
      status,
      renderLogin({ lang, request: String(req.body.request), clientName: request.clientName, redirectHost: back.host, username, error }),
      lang,
      request.redirectUri,
    );
  if (!username || !password) return show(400, errors.missing);

  // The same lock as the app's sign-in: failed tries count per address and account.
  const c = await collections();
  const key = `mcp-login:${clientIp(req)}:${username}`;
  if ((await peekRateLimit(c, key, LOGIN_ATTEMPTS))?.limited) return show(429, errors.tooMany);
  const user = await c.users.findOne({ username });
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    const limit = await hitRateLimit(c, key, LOGIN_ATTEMPTS, LOGIN_WINDOW);
    return show(limit.limited ? 429 : 401, limit.limited ? errors.tooMany : errors.wrong);
  }
  if (!user.profile) return show(409, errors.noProfile);

  const code = randomToken();
  await c.oauthCodes.insertOne({
    hash: hashSecret(code),
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scopes: request.scopes,
    resource: request.resource,
    userId: new ObjectId(user._id),
    expiresAt: new Date(Date.now() + CODE_TTL),
  });
  back.searchParams.set("code", code);
  res.redirect(302, back.href);
}
