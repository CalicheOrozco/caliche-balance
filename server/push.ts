import type { ObjectId } from "mongodb";
import webpush from "web-push";
import type { Collections } from "./db.ts";

/**
 * Web Push notifications. On iPhone they work for the installed app (iOS 16.4+) once the person
 * allows them. Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; without them push is off.
 */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  publicKey: string;
  /** "gone" means the browser dropped the subscription and it should be deleted. */
  send(target: PushTarget, payload: string): Promise<"sent" | "gone">;
}

export function webPushSender(): PushSender | undefined {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  // Apple rejects subjects that are not a mailto: or a public https URL.
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return undefined;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return {
    publicKey,
    async send(target, payload) {
      try {
        await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
          TTL: 24 * 60 * 60,
        });
        return "sent";
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return "gone";
        throw error;
      }
    },
  };
}

export type NotificationKind = "newWeighIn" | "zepp" | "test";

interface Message {
  title: string;
  body: string;
  /** Screen the notification opens. */
  url: string;
}

type Language = "es" | "en";
type Unit = "kg" | "lb";

const LB_PER_KG = 2.2046226218;

function formatWeight(kg: number, unit: Unit, lang: Language, signed = false): string {
  const value = unit === "lb" ? kg * LB_PER_KG : kg;
  const text = Math.abs(value).toLocaleString(lang === "es" ? "es-MX" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // A real minus sign reads better than a hyphen in notifications.
  const sign = !signed ? "" : value > 0.05 ? "+" : value < -0.05 ? "−" : "";
  return `${sign}${text} ${unit}`;
}

/** Notification texts live here, next to the only code that sends them. */
export const messages = {
  newWeighIn: (lang: Language, unit: Unit, weightKg: number, deltaKg: number | null): Message => ({
    title: "Caliche Balance",
    body:
      lang === "es"
        ? `Nueva pesada: ${formatWeight(weightKg, unit, lang)}${deltaKg === null ? "" : ` (${formatWeight(deltaKg, unit, lang, true)})`}`
        : `New weigh-in: ${formatWeight(weightKg, unit, lang)}${deltaKg === null ? "" : ` (${formatWeight(deltaKg, unit, lang, true)})`}`,
    url: "/",
  }),
  zeppExpired: (lang: Language): Message => ({
    title: "Caliche Balance",
    body:
      lang === "es"
        ? "Tu token de Zepp caducó. Pega uno nuevo en Ajustes para seguir recibiendo tus pesadas."
        : "Your Zepp token expired. Paste a new one in Settings to keep receiving your weigh-ins.",
    url: "/ajustes",
  }),
  test: (lang: Language): Message => ({
    title: "Caliche Balance",
    body: lang === "es" ? "Las notificaciones funcionan. 💚" : "Notifications are working. 💚",
    url: "/ajustes",
  }),
};

/**
 * Sends a notification to every device a person subscribed, if they allow that kind.
 * Never throws: a failed notification must not break a sync.
 */
export async function notifyUser(
  c: Collections,
  sender: PushSender | undefined,
  userId: ObjectId,
  kind: NotificationKind,
  build: (lang: Language, unit: Unit) => Message,
): Promise<number> {
  if (!sender) return 0;
  try {
    const user = await c.users.findOne({ _id: userId });
    if (!user) return 0;
    if (kind !== "test" && user.notifications?.[kind] === false) return 0;
    const message = build(user.profile?.language ?? "es", user.profile?.unit ?? "kg");
    const payload = JSON.stringify(message);
    const subscriptions = await c.pushSubscriptions.find({ userId }).toArray();
    let sent = 0;
    for (const sub of subscriptions) {
      try {
        const result = await sender.send(sub, payload);
        if (result === "gone") await c.pushSubscriptions.deleteOne({ _id: sub._id });
        else sent++;
      } catch (error) {
        console.error("push failed", (error as Error).message);
      }
    }
    return sent;
  } catch (error) {
    console.error("notifyUser failed", (error as Error).message);
    return 0;
  }
}
