import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import type { Collections, UserDoc } from "./db.ts";

export const SESSION_COOKIE = "cb_session";
const SESSION_DAYS = 90;

/** Random secret for session cookies. */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Recovery codes are typed by hand, so they use an unambiguous alphabet in groups. */
export function newRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{4})(?=.)/g, "$1-");
}

/** Secrets that are long and random only need a fast hash; passwords use argon2. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password);

export async function startSession(c: Collections, res: Response, userId: ObjectId, secure: boolean): Promise<void> {
  const token = newSecret();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await c.sessions.insertOne({ _id: new ObjectId(), tokenHash: hashSecret(token), userId, createdAt: now, expiresAt });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", expires: expiresAt });
}

export async function endSession(c: Collections, req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") await c.sessions.deleteOne({ tokenHash: hashSecret(token) });
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

declare global {
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

/** Resolves the caller from the session cookie. */
export function requireUser(c: Collections) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const cookie = req.cookies?.[SESSION_COOKIE];
    if (typeof cookie === "string") {
      const session = await c.sessions.findOne({ tokenHash: hashSecret(cookie), expiresAt: { $gt: new Date() } });
      const user = session && (await c.users.findOne({ _id: session.userId }));
      if (user) {
        req.user = user;
        return next();
      }
    }

    res.status(401).json({ error: "unauthorized" });
  };
}
