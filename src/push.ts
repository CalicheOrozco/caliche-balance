import { api, ApiError } from "./api.ts";

/**
 * Push notifications on this device. On iPhone they need the app installed on the home screen
 * (iOS 16.4+) and permission granted from a tap.
 */

/** "misconfigured": the server has notification keys, but in a format it cannot use. */
export type PushState = "unsupported" | "needs-install" | "unavailable" | "misconfigured" | "denied" | "off" | "on";

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/** The VAPID key arrives as base64url; PushManager wants bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "needs-install";
  if (!("PushManager" in window) || !("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  if (!reg) return "unsupported";
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

/** Must run from a tap: browsers only show the permission prompt for a user gesture. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const key = await api.pushKey().catch((error: unknown) => (error instanceof ApiError && error.code === "push-misconfigured" ? "misconfigured" : null));
  if (key === "misconfigured") return "misconfigured";
  if (!key) return "unavailable";
  const reg = await navigator.serviceWorker.ready;
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.publicKey) }));
  await api.pushSubscribe(subscription.toJSON());
  return "on";
}

/** Stops notifications on this device, on the server and in the browser. */
export async function disablePush(): Promise<void> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await api.pushUnsubscribe(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
