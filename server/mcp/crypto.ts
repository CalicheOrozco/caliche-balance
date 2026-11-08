import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const randomToken = () => randomBytes(32).toString("base64url");

const key = (secret: string) => createHash("sha256").update(secret).digest();

/** AES-256-GCM, so the sign-in request carried by the form cannot be read or changed by the browser. */
export function encrypt(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function decrypt<T>(payload: string, secret: string): T {
  const raw = Buffer.from(String(payload), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const data = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  return JSON.parse(data.toString("utf8")) as T;
}
