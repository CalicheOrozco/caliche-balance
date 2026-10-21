import type { ObjectId } from "mongodb";
import webpush from "web-push";
import { BADGE_NAMES, type BadgeId, TIER_NAMES, TIERS } from "../shared/achievements.ts";
import type { GoalEvent } from "../shared/goals.ts";
import type { Collections } from "./db.ts";
import { envValue } from "./env.ts";

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

export type PushSetup = { sender: PushSender; problem: null } | { sender: undefined; problem: "missing" | "invalid" };

/**
 * Notifications are optional: without the three settings, or with ones that web-push rejects, the
 * API still starts and only notifications are off. The log names the setting at fault, never its value.
 */
export function webPushSetup(env: Record<string, string | undefined> = process.env): PushSetup {
  const publicKey = envValue("VAPID_PUBLIC_KEY", env);
  const privateKey = envValue("VAPID_PRIVATE_KEY", env);
  // Apple rejects subjects that are not a mailto: or a public https URL.
  const subject = envValue("VAPID_SUBJECT", env);
  if (!publicKey || !privateKey || !subject) return { sender: undefined, problem: "missing" };
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (error) {
    const message = (error as Error).message;
    const which = /subject/i.test(message) ? "VAPID_SUBJECT" : /private/i.test(message) ? "VAPID_PRIVATE_KEY" : "VAPID_PUBLIC_KEY";
    console.error(`Notifications are off: ${which} is not valid. Check its value in the hosting settings.`);
    return { sender: undefined, problem: "invalid" };
  }
  return { sender: webPushClient(publicKey), problem: null };
}

function webPushClient(publicKey: string): PushSender {
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

export type NotificationKind = "newWeighIn" | "zepp" | "goals" | "streak" | "test";

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
  goal: (lang: Language, unit: Unit, event: GoalEvent): Message => {
    const es = lang === "es";
    // Under two weeks reads better in days.
    const took = (days: number) =>
      days === 0
        ? es
          ? "menos de un día"
          : "less than a day"
        : days < 14
          ? es
            ? `${days} ${days === 1 ? "día" : "días"}`
            : `${days} ${days === 1 ? "day" : "days"}`
          : es
            ? `${Math.round(days / 7)} semanas`
            : `${Math.round(days / 7)} weeks`;
    const pct = (n: number) => n.toLocaleString(es ? "es-MX" : "en-US", { maximumFractionDigits: 1 });
    if (event.kind === "weight-reached") {
      return {
        title: "Caliche Balance",
        body: es
          ? `¡Llegaste a tu meta de ${formatWeight(event.targetKg, unit, lang)}! Te tomó ${took(event.days)}. 💚`
          : `You reached your goal of ${formatWeight(event.targetKg, unit, lang)}! It took ${took(event.days)}. 💚`,
        url: "/",
      };
    }
    if (event.kind === "fat-reached") {
      return {
        title: "Caliche Balance",
        body: es
          ? `¡Llegaste a tu meta de ${pct(event.targetPct)} % de grasa! Te tomó ${took(event.days)}. 💚`
          : `You reached your goal of ${pct(event.targetPct)} % body fat! It took ${took(event.days)}. 💚`,
        url: "/",
      };
    }
    const range = `${formatWeight(event.minKg, unit, lang)} ${es ? "a" : "to"} ${formatWeight(event.maxKg, unit, lang)}`;
    return {
      title: "Caliche Balance",
      body: es
        ? `Tu peso (${formatWeight(event.weightKg, unit, lang)}) quedó ${event.side === "above" ? "arriba" : "abajo"} de tu rango para mantener (${range}).`
        : `Your weight (${formatWeight(event.weightKg, unit, lang)}) is ${event.side} your maintenance range (${range}).`,
      url: "/",
    };
  },
  badges: (lang: Language, ups: { id: BadgeId; level: number; count: number }[]): Message => {
    const es = lang === "es";
    const one = ups[0]!;
    const tier = TIER_NAMES[lang][TIERS[one.level - 1]!];
    const name = BADGE_NAMES[lang][one.id];
    return {
      title: "Caliche Balance",
      body:
        ups.length > 1
          ? es
            ? `🏅 ${ups.length} logros subieron de nivel. Entre ellos: «${name}», ahora ${tier}.`
            : `🏅 ${ups.length} badges went up a level, including "${name}", now ${tier}.`
          : one.level === 1
            ? es
              ? `🏅 ¡Logro nuevo: «${name}»!`
              : `🏅 New badge: "${name}"!`
            : es
              ? `🏅 «${name}» subió a ${tier}. Ya lo lograste ${one.count} veces.`
              : `🏅 "${name}" is now ${tier}. You have earned it ${one.count} times.`,
      url: "/logros",
    };
  },
  streakReminder: (lang: Language, days: number, freezes: number): Message => ({
    title: "Caliche Balance",
    body:
      lang === "es"
        ? freezes > 0
          ? `⚡ Llevas ${days} días seguidos. Pésate hoy para no gastar un comodín (te ${freezes === 1 ? "queda 1" : `quedan ${freezes}`}).`
          : `⚡ Tu racha de ${days} días termina hoy. ¡Pésate antes de dormir!`
        : freezes > 0
          ? `⚡ ${days} days in a row. Weigh in today so you don't spend a freeze (${freezes} left).`
          : `⚡ Your ${days}-day streak ends today. Weigh in before bed!`,
    url: "/",
  }),
  streakNudge: (lang: Language, kind: "close" | "tie" | "record", current: number, best: number): Message => ({
    title: "Caliche Balance",
    body:
      lang === "es"
        ? kind === "record"
          ? `🏆 ¡Nuevo récord! ${current} días seguidos.`
          : kind === "tie"
            ? `⚡ Igualaste tu récord de ${best} días. Mañana lo superas.`
            : `⚡ Estás a 2 días de tu récord de ${best} días.`
        : kind === "record"
          ? `🏆 New record! ${current} days in a row.`
          : kind === "tie"
            ? `⚡ You tied your ${best}-day record. Beat it tomorrow.`
            : `⚡ You are 2 days away from your ${best}-day record.`,
    url: "/",
  }),
  rewardEarned: (lang: Language, text: string, days: number): Message => ({
    title: "Caliche Balance",
    body: lang === "es" ? `🎁 ¡${days} días seguidos! Te ganaste tu premio: ${text}.` : `🎁 ${days} days in a row! You earned your reward: ${text}.`,
    url: "/logros",
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
