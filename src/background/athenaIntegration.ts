// Dormant unless an org's own MDM/Group Policy populates ManagedPolicy.athena
// via chrome.storage.managed -- see managed_schema.json and types.ts'
// AthenaConfig for the exact shape. Every exported function here is a no-op
// (or returns null/empty) the instant isAthenaConfigured() is false, which is
// the case for every normal, open-source, non-enterprise install: there is no
// Settings toggle anywhere that can turn this on, only an org's own policy
// push can.
//
// What this file does, end to end: local blocking decisions already made
// elsewhere (matchStats.ts's security-rule matches, index.ts's popup/redirect
// firewall catches) get queued here as minimized events -- never the request
// that triggered them, only category/risk-tier/rule-reference -- then batched
// and POSTed to the org's own Athena instance on a short interval. Blocking
// itself never waits on any of this: by the time an event reaches this
// module, the thing it describes has already happened locally.
import browser from "webextension-polyfill";
import { fetchAndApplyPolicy } from "./athenaPolicySync";
import { isHttpsUrl } from "../shared/httpsUrl";
import type { AthenaConfig, AthenaSecurityEvent, ManagedPolicy } from "../types";

export function isAthenaConfigured(policy: ManagedPolicy): policy is ManagedPolicy & { athena: AthenaConfig } {
  const athena = policy.athena;
  if (!athena) return false;
  if (!athena.tenantId || !athena.agentId || !athena.bootstrapSecret) return false;
  // A misconfigured http:// endpoint would send bootstrapSecret and the
  // resulting session token in cleartext -- see shared/httpsUrl.ts.
  return isHttpsUrl(athena.bootstrapUrl) && isHttpsUrl(athena.eventsUrl);
}

interface AthenaSession {
  token: string;
  /** Epoch ms. Treated as expired EXPIRY_BUFFER_MS early so a request never
   * races a token that's about to lapse mid-flight. */
  expiresAt: number;
}

const SESSION_KEY = "athenaSession";
const QUEUE_KEY = "athenaEventQueue";
const EXPIRY_BUFFER_MS = 60_000;
// Caps memory/storage use if eventsUrl is unreachable for an extended
// stretch -- drops the oldest events first, same "keep going, don't jam"
// posture as liveUpdates.ts silently keeping the last-known-good state on a
// failed fetch rather than blocking anything else on it.
const MAX_QUEUE_LENGTH = 200;

function isValidSession(value: unknown): value is AthenaSession {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AthenaSession).token === "string" &&
    typeof (value as AthenaSession).expiresAt === "number"
  );
}

async function getCachedSession(): Promise<AthenaSession | null> {
  const stored = await browser.storage.session.get(SESSION_KEY);
  const session = stored[SESSION_KEY];
  if (!isValidSession(session)) return null;
  if (session.expiresAt - EXPIRY_BUFFER_MS <= Date.now()) return null;
  return session;
}

/** Exchanges bootstrapSecret for a short-lived token, caching it in
 * browser.storage.session (in-memory, gone on browser/extension restart --
 * same lifetime class as the fingerprint-rotation seed in settings.ts) so
 * every flush doesn't re-authenticate. Never writes to storage.local/sync,
 * which aren't encrypted at rest -- see AthenaConfig's own doc comment. */
export async function getAthenaSession(config: AthenaConfig): Promise<AthenaSession | null> {
  const cached = await getCachedSession();
  if (cached) return cached;

  try {
    const response = await fetch(config.bootstrapUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: config.tenantId,
        agent_id: config.agentId,
        enrollment_secret: config.bootstrapSecret,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { access_token?: unknown }).access_token !== "string" ||
      typeof (body as { expires_at?: unknown }).expires_at !== "string"
    ) {
      return null;
    }
    const expiresAt = Date.parse((body as { expires_at: string }).expires_at);
    if (!Number.isFinite(expiresAt)) return null;
    const session: AthenaSession = { token: (body as { access_token: string }).access_token, expiresAt };
    await browser.storage.session.set({ [SESSION_KEY]: session });
    return session;
  } catch {
    // Athena instance unreachable, org network down, etc. -- callers treat
    // null the same as "try again next flush," never as an error to surface.
    return null;
  }
}

async function getQueue(): Promise<AthenaSecurityEvent[]> {
  const stored = await browser.storage.session.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY];
  return Array.isArray(queue) ? (queue as AthenaSecurityEvent[]) : [];
}

/** No-ops instantly when Athena isn't configured, so every call site that
 * might fire on a normal install (matchStats.ts, index.ts) stays a single
 * cheap check, not a policy-read-and-branch at every call site. */
export async function queueSecurityEvent(
  policy: ManagedPolicy,
  event: Omit<AthenaSecurityEvent, "eventId" | "timestamp">
): Promise<void> {
  if (!isAthenaConfigured(policy)) return;
  const queue = await getQueue();
  queue.push({ ...event, eventId: crypto.randomUUID(), timestamp: Date.now() });
  const trimmed = queue.length > MAX_QUEUE_LENGTH ? queue.slice(queue.length - MAX_QUEUE_LENGTH) : queue;
  await browser.storage.session.set({ [QUEUE_KEY]: trimmed });
}

export async function flushSecurityEvents(policy: ManagedPolicy): Promise<void> {
  if (!isAthenaConfigured(policy)) return;
  const queue = await getQueue();
  if (queue.length === 0) return;

  const session = await getAthenaSession(policy.athena);
  if (!session) return; // Leave the queue intact -- retried on the next alarm tick.

  try {
    let sent = 0;
    for (const event of queue) {
      const response = await fetch(policy.athena.eventsUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
        body: JSON.stringify({
          source_event_id: event.eventId,
          occurred_at: new Date(event.timestamp).toISOString(),
          action: event.category === "override" ? "allowed_override" : "blocked",
          severity: event.riskTier,
          rule_id: event.rulesetId ? `${event.rulesetId}:${event.ruleId ?? "unknown"}` : event.category,
          target_indicator: event.domain,
          evidence: {
            category: event.category,
            ...(event.note ? { override_reason: event.note } : {}),
          },
        }),
      });
      if (!response.ok) break;
      sent += 1;
    }
    if (sent > 0) await browser.storage.session.set({ [QUEUE_KEY]: queue.slice(sent) });
  } catch {
    // Unreachable -- same "keep going, try again next tick" posture as above.
  }
}

const ALARM_NAME = "moat-athena-flush";
// Security events are more time-sensitive than the daily filter/redirect
// refresh in liveUpdates.ts, so this runs far more often -- still the same
// already-declared `alarms` permission, no new permission needed.
const PERIOD_MINUTES = 5;

export function initAthenaIntegration(getPolicy: () => Promise<ManagedPolicy>): void {
  void browser.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: PERIOD_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    void (async () => {
      const policy = await getPolicy();
      await flushSecurityEvents(policy);
      // fetchAndApplyPolicy no-ops on its own (isPolicySyncConfigured) when
      // policy distribution isn't set up -- same "always safe to call"
      // contract as flushSecurityEvents above.
      if (policy.athena) {
        const session = await getAthenaSession(policy.athena);
        if (session) await fetchAndApplyPolicy(policy.athena, session.token);
      }
    })();
  });
}
