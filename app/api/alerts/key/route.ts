import { json } from "@/lib/auth";
import { vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

/** GET /api/alerts/key - the public VAPID key the browser needs to subscribe (null when push isn't set up). */
export async function GET() {
  return json({ publicKey: vapidPublicKey() });
}
