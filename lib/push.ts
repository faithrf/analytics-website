import "server-only";
import * as webpush from "web-push";
import { getAlertStore, type PushSub } from "@/lib/alerts-store";

export interface PushPayload {
  title: string;
  body: string;
  /** one notification per symbol: a newer alert for it replaces the older */
  tag: string;
  /** where a tap goes */
  url: string;
}

const SITE = "https://website-analytics-meridian.vercel.app";
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let ready = false;
function init(): boolean {
  if (ready) return true;
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject || SITE, pub, priv);
  ready = true;
  return true;
}

/** Pushes to every device of a user; drops subscriptions the push service says are gone. Returns how many got it. */
export async function pushToUser(userId: string, subs: PushSub[], payload: PushPayload): Promise<number> {
  if (!init()) return 0;
  const store = getAlertStore();
  const body = JSON.stringify(payload);
  let delivered = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body, { TTL: 3600, urgency: "high" });
        delivered++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await store?.removeSub(userId, sub.endpoint);
      }
    }),
  );
  return delivered;
}
