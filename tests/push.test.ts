import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { envValue } from "../server/env.ts";
import { webPushSetup } from "../server/push.ts";

const keys = webpush.generateVAPIDKeys();
const good = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "https://caliche-balance.vercel.app" };

describe("push settings", () => {
  it("reads values the way people paste them into a dashboard", () => {
    expect(envValue("A", { A: `  "abc"  ` })).toBe("abc");
    expect(envValue("A", { A: "A=abc" })).toBe("abc");
    expect(envValue("A", { A: "A='abc'" })).toBe("abc");
    expect(envValue("A", { A: "  " })).toBeUndefined();
  });

  it("works with good keys, even pasted with quotes or the whole line", () => {
    expect(webPushSetup(good).problem).toBeNull();
    expect(webPushSetup({ ...good, VAPID_PUBLIC_KEY: `"${keys.publicKey}"`, VAPID_PRIVATE_KEY: `VAPID_PRIVATE_KEY=${keys.privateKey}` }).sender?.publicKey).toBe(keys.publicKey);
  });

  it("turns notifications off instead of crashing when keys are missing or malformed", () => {
    expect(webPushSetup({}).problem).toBe("missing");
    expect(webPushSetup({ ...good, VAPID_SUBJECT: "caliche-balance.vercel.app" }).problem).toBe("invalid");
    expect(webPushSetup({ ...good, VAPID_PUBLIC_KEY: "no es una llave" }).problem).toBe("invalid");
  });
});
