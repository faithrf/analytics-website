/**
 * Customer engagement platform hook. Server-side only: client events arrive
 * through POST /api/track. Sink is the console in development; set
 * CEP_WEBHOOK_URL to also POST each payload as JSON. Never throws.
 */
export type TrackEvent =
  | "login"
  | "signed_up"
  | "logout"
  | "board_saved"
  | "watchlist_add"
  | "watchlist_remove"
  | "leader_follow"
  | "leader_unfollow"
  | "tab_viewed";

export const TRACK_EVENTS: readonly TrackEvent[] = [
  "login", "signed_up", "logout", "board_saved", "watchlist_add", "watchlist_remove", "leader_follow", "leader_unfollow", "tab_viewed",
];
/** Events the browser may report itself; the rest are only fired server-side. */
export const CLIENT_EVENTS: readonly TrackEvent[] = ["tab_viewed"];

export interface TrackUser {
  id: string;
  email?: string;
  name?: string;
}
export interface TrackOpts {
  /** Real actor's id when an admin is impersonating the user. */
  impersonatedBy?: string;
  now?: number;
}

export type Payload =
  | { type: "identify"; userId: string; traits: Record<string, unknown>; timestamp: string; impersonatedBy?: string }
  | { type: "track"; userId: string; event: string; props: Record<string, unknown>; timestamp: string; impersonatedBy?: string };

export function buildIdentify(user: TrackUser, traits: Record<string, unknown> = {}, opts: TrackOpts = {}): Payload {
  const p: Payload = {
    type: "identify",
    userId: user.id,
    traits: { ...(user.email ? { email: user.email } : {}), ...(user.name ? { name: user.name } : {}), ...traits },
    timestamp: new Date(opts.now ?? Date.now()).toISOString(),
  };
  if (opts.impersonatedBy) p.impersonatedBy = opts.impersonatedBy;
  return p;
}

export function buildTrack(userId: string, event: string, props: Record<string, unknown> = {}, opts: TrackOpts = {}): Payload {
  const p: Payload = { type: "track", userId, event, props, timestamp: new Date(opts.now ?? Date.now()).toISOString() };
  if (opts.impersonatedBy) p.impersonatedBy = opts.impersonatedBy;
  return p;
}

const TIMEOUT_MS = 2000;

/** Console in dev, plus the webhook when configured. Fire-and-forget; swallows every error. */
export function emit(payload: Payload): void {
  try {
    if (process.env.NODE_ENV !== "production") console.log("[cep]", JSON.stringify(payload));
    const url = process.env.CEP_WEBHOOK_URL;
    if (!url) return;
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => {});
  } catch {
    /* tracking must never break a request */
  }
}

export function identify(user: TrackUser, traits: Record<string, unknown> = {}, opts: TrackOpts = {}): void {
  emit(buildIdentify(user, traits, opts));
}

export function track(userId: string, event: TrackEvent, props: Record<string, unknown> = {}, opts: TrackOpts = {}): void {
  emit(buildTrack(userId, event, props, opts));
}
