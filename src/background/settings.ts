import browser from "webextension-polyfill";
import {
  DEFAULT_SETTINGS,
  SETTINGS_PATCH_ALLOWED_FIELDS,
  STORAGE_KEY,
  type OverridableSettingKey,
  type Settings,
} from "../types";
import { PRESETS } from "../shared/filterPresets";
import { applyPrivacySettings } from "./privacySettings";
import { applyFilterGroupState } from "./filterGroups";
import { applyCustomRules } from "./applyCustomRules";
import { reconcileOptionalContentScripts } from "./optionalContentScripts";
import { applyPermissionGuard } from "./permissionGuard";
import { applyCnameUncloak } from "./cnameUncloak";
import { applyCnameUncloakChrome } from "./cnameUncloakChrome";
import { getManagedPolicy, applyManagedOverrides } from "./managedPolicy";
import { exportSettings } from "./settingsPortability";
import { isSafeCosmeticSelector } from "../shared/selectorSafety";
import { matchesDomainOrSubdomain } from "../shared/domainChain";
import { recordRuleCreated, recordRuleRemoved } from "./customRuleStats";

// Deliberately a separate storage.local key, not part of Settings/STORAGE_KEY
// -- it must never get swept into the blob that gets mirrored *to* sync
// itself (that would be recording sync status inside the synced data).
const SYNC_STATUS_KEY = "syncStatus";

export interface SyncStatus {
  ok: boolean;
  when: number;
}

async function recordSyncStatus(ok: boolean): Promise<void> {
  await browser.storage.local.set({ [SYNC_STATUS_KEY]: { ok, when: Date.now() } satisfies SyncStatus });
}

/** Whether the last opt-in sync mirror attempt succeeded -- null if sync has
 * never been attempted on this install (never turned on, or turned on but
 * no setting has changed since). See options.ts: only surfaced to the user
 * when it's actually failed, same "stay quiet unless something's wrong"
 * posture as the filter-budget warning. */
export async function getSyncStatus(): Promise<SyncStatus | null> {
  const stored = await browser.storage.local.get(SYNC_STATUS_KEY);
  return (stored[SYNC_STATUS_KEY] as SyncStatus | undefined) ?? null;
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...value };
}

/** getSettings() merged with any enterprise-managed policy -- what should actually be enforced. */
export async function getEffectiveSettings(): Promise<Settings> {
  const [settings, policy] = await Promise.all([getSettings(), getManagedPolicy()]);
  return applyManagedOverrides(settings, policy);
}

async function applyEffectiveSettings(options: { forceFilterGroups?: boolean } = {}): Promise<void> {
  const effective = await getEffectiveSettings();
  await Promise.all([
    applyPrivacySettings(effective),
    applyFilterGroupState(effective, { force: options.forceFilterGroups }),
    applyCustomRules(effective),
    reconcileOptionalContentScripts(effective),
    applyPermissionGuard(effective),
  ]);
  // Each gates itself via its own isSupported() (Firefox's dns.resolve()
  // path vs. Chrome's DoH-observational path) -- calling both here is safe
  // on every browser, exactly one ever actually registers a listener.
  applyCnameUncloak(effective);
  applyCnameUncloakChrome(effective);
}

// Every mutation below reads the current settings, merges a patch, and
// writes the result back -- without serialization, two concurrent mutations
// (two rapid element picks, a toggle flip while a picker save is in flight)
// each read the same stale snapshot and the second write clobbers the
// first's change. `pending` chains every mutation through a single-file
// queue so each one sees the previous one's already-applied result.
let pending: Promise<unknown> = Promise.resolve();

/** mutator returns null to signal "no change needed" (skips the write and
 * the settings re-apply); otherwise a patch to merge onto the just-read
 * current settings. */
function mutateSettings(mutator: (current: Settings) => Partial<Settings> | null): Promise<Settings> {
  const result = pending.then(async () => {
    const current = await getSettings();
    const patch = mutator(current);
    if (patch === null) return current;
    const next = { ...current, ...patch };
    await browser.storage.local.set({ [STORAGE_KEY]: next });
    if (next.syncEnabled) {
      // Best-effort, opt-in mirror -- a quota failure (storage.sync caps at
      // ~100KB total / ~8KB per item) just means sync silently doesn't
      // happen for this install. Not silent to the user though: the result
      // (ok or failed) is recorded via recordSyncStatus so options.ts can
      // surface a failure -- see getSyncStatus's own comment for why this
      // still doesn't block the mutation itself.
      void browser.storage.sync
        .set({ [STORAGE_KEY]: exportSettings(next) })
        .then(() => recordSyncStatus(true))
        .catch(() => recordSyncStatus(false));
    }
    await applyEffectiveSettings();
    return next;
  });
  pending = result.catch(() => {});
  return result;
}

/** Seeds a fresh install's local settings from an existing synced copy, if
 * one exists -- only when storage.local genuinely has nothing yet (never
 * overwrites real local settings). Opt-in: only meaningful once
 * settings.syncEnabled has been turned on somewhere and mirrored a copy to
 * sync; on a brand new install with sync never enabled anywhere, this is a
 * no-op. Not a live bidirectional sync -- seeds once, then normal writes
 * take over. */
export async function seedFromSyncIfEmpty(): Promise<void> {
  const local = await browser.storage.local.get(STORAGE_KEY);
  if (STORAGE_KEY in local) return;
  try {
    const synced = await browser.storage.sync.get(STORAGE_KEY);
    const value = synced[STORAGE_KEY] as Partial<Settings> | undefined;
    if (value) await browser.storage.local.set({ [STORAGE_KEY]: { ...DEFAULT_SETTINGS, ...value } });
  } catch {
    // storage.sync unavailable (sync disabled, no signed-in account, etc.) --
    // fine, stay on local defaults.
  }
}

/**
 * Applied only on a genuine fresh install (browser.runtime.onInstalled's
 * details.reason === "install" -- see background/index.ts), and only after
 * seedFromSyncIfEmpty() has already had its chance to run first: if that
 * seeded real settings from another synced device, storage.local is no
 * longer empty by the time this runs, so this is a no-op and the synced
 * settings win, exactly like every other "only if truly empty" check here.
 *
 * Otherwise, a brand new install starts from the "lite" preset instead of
 * DEFAULT_SETTINGS' implicit filterGroups: {} (which effectiveFilterGroupState
 * reads as "every group on"). Moat's bundled filter lists sum to roughly
 * 276,000 rules across all 11 groups -- about 9x the 30,000 static rules
 * Chrome guarantees any one extension, with the remainder drawn from a pool
 * shared across every installed extension (see README's Known Limitations
 * section, and applyFilterGroupState's graceful-degradation retry loop,
 * which this doesn't replace -- it just gives that retry loop a much
 * smaller number to start from on day one).
 */
export async function applyFreshInstallDefaults(): Promise<void> {
  const local = await browser.storage.local.get(STORAGE_KEY);
  if (STORAGE_KEY in local) return;
  await browser.storage.local.set({
    [STORAGE_KEY]: { ...DEFAULT_SETTINGS, filterGroups: PRESETS.lite.filterGroups },
  });
}

export function setSettings(patch: Partial<Settings>): Promise<Settings> {
  return mutateSettings(() => patch);
}

/** Narrows an arbitrary object down to only the fields
 * SETTINGS_PATCH_ALLOWED_FIELDS lists, dropping everything else -- the
 * runtime half of the "set-settings-patch" message's trust boundary (see
 * that constant's own comment in types.ts). Pulled out as its own pure
 * function, the same way cnameUncloakMatch.ts/customRules.ts separate
 * logic from browser-API wiring, so index.ts's message handler doesn't
 * carry the only test coverage for what's actually a security boundary. */
export function pickAllowedSettingsPatch(patch: unknown): Partial<Settings> {
  if (typeof patch !== "object" || patch === null) return {};
  const safe: Record<string, unknown> = {};
  for (const field of SETTINGS_PATCH_ALLOWED_FIELDS) {
    if (field in patch) safe[field] = (patch as Record<string, unknown>)[field];
  }
  return safe;
}

/** Re-applies everything against current settings -- call at startup, and
 * whenever managed policy itself changes. `force` bypasses filterGroups.ts's
 * "nothing changed since last fully-successful apply" fast path -- used
 * once a day by liveUpdates.ts to notice the browser's shared static-rule
 * budget changing for reasons entirely outside Moat's own settings (another
 * extension being disabled/enabled). Every other caller leaves it off. */
export async function reapplySettings(options: { force?: boolean } = {}): Promise<void> {
  await applyEffectiveSettings({ forceFilterGroups: options.force });
}

export async function isSiteDisabled(hostname: string): Promise<boolean> {
  const settings = await getEffectiveSettings();
  return !settings.enabled || matchesDomainOrSubdomain(hostname, settings.disabledSites);
}

export function setSiteDisabled(hostname: string, disabled: boolean): Promise<Settings> {
  return mutateSettings((current) => {
    const set = new Set(current.disabledSites);
    if (disabled) set.add(hostname);
    else set.delete(hostname);
    return { disabledSites: [...set] };
  });
}

type SelectorMapField = "customCosmeticRules" | "customGrayscaleRules";

/** Shared by the "Hide" and "Gray out" element-picker modes -- both are
 * hostname -> selector[] maps with identical add/remove semantics. */
function addSelectorRule(field: SelectorMapField, hostname: string, selector: string): Promise<Settings> {
  return mutateSettings((current) => {
    // Same check settingsPortability.ts applies to imported selectors -- both
    // paths end up in an injected <style> block, so neither may persist a
    // selector that could close that block early and inject an unrelated CSS
    // rule. generateSelector.ts never emits these characters; a rejection
    // here means something else produced the string.
    if (!isSafeCosmeticSelector(selector)) {
      console.warn("moat: refusing to save an unsafe cosmetic selector");
      return null;
    }
    const existing = current[field][hostname] ?? [];
    if (existing.includes(selector)) return null;
    return { [field]: { ...current[field], [hostname]: [...existing, selector] } } as Partial<Settings>;
  });
}

function removeSelectorRule(field: SelectorMapField, hostname: string, selector: string): Promise<Settings> {
  return mutateSettings((current) => {
    const remaining = (current[field][hostname] ?? []).filter((s) => s !== selector);
    const next = { ...current[field] };
    if (remaining.length > 0) {
      next[hostname] = remaining;
    } else {
      delete next[hostname];
    }
    return { [field]: next } as Partial<Settings>;
  });
}

/** value: null clears the override for hostname/key, reverting to the
 * global setting -- see shared/perSiteOverrides.ts's effectiveValue(). Tidies
 * up an empty per-host entry entirely, same as removeSelectorRule above. */
export function setPerSiteOverride(
  hostname: string,
  key: OverridableSettingKey,
  value: boolean | null
): Promise<Settings> {
  return mutateSettings((current) => {
    const next = { ...current.perSiteOverrides };
    const existing = { ...next[hostname] };
    if (value === null) {
      delete existing[key];
    } else {
      existing[key] = value;
    }
    if (Object.keys(existing).length > 0) {
      next[hostname] = existing;
    } else {
      delete next[hostname];
    }
    return { perSiteOverrides: next };
  });
}

type DomainListField = "customBlockedDomains" | "customAllowedDomains";

/** Same reasoning as setSiteDisabled's Set-based patch above: the add/
 * remove decision is computed from `current` *inside* the mutator, at the
 * moment mutateSettings actually applies it -- not from a snapshot the
 * caller read separately beforehand and turned into a full replacement
 * array, which would silently discard whatever else changed to this same
 * list in between the read and the write. */
function addCustomDomain(field: DomainListField, hostname: string): Promise<Settings> {
  return mutateSettings((current) => {
    const set = new Set(current[field]);
    if (set.has(hostname)) return null;
    set.add(hostname);
    return { [field]: [...set] } as Partial<Settings>;
  });
}

function removeCustomDomain(field: DomainListField, hostname: string): Promise<Settings> {
  return mutateSettings((current) => {
    if (!current[field].includes(hostname)) return null;
    return { [field]: current[field].filter((d) => d !== hostname) } as Partial<Settings>;
  });
}

export const addCustomBlockedDomain = (hostname: string): Promise<Settings> =>
  addCustomDomain("customBlockedDomains", hostname);
export const removeCustomBlockedDomain = (hostname: string): Promise<Settings> =>
  removeCustomDomain("customBlockedDomains", hostname);
export const addCustomAllowedDomain = (hostname: string): Promise<Settings> =>
  addCustomDomain("customAllowedDomains", hostname);
export const removeCustomAllowedDomain = (hostname: string): Promise<Settings> =>
  removeCustomDomain("customAllowedDomains", hostname);

// Each wrapper also stamps/clears this rule's entry in customRuleStats.ts's
// separate local-only store (createdAt/hitCount/lastMatchedAt -- see the
// Custom Rules tab's staleness feature). recordRuleCreated is idempotent
// (a no-op if the rule already has stats, e.g. addSelectorRule found it
// already existed) and recordRuleRemoved a no-op if it never had any, so
// neither needs to know whether the underlying add/remove actually changed
// anything -- and reconcileCustomRuleStats' startup sweep (background/
// index.ts) cleans up the rare case where addSelectorRule rejected the
// selector outright (an unsafe selector) but this still fired.
export const addCustomCosmeticRule = async (hostname: string, selector: string): Promise<Settings> => {
  const result = await addSelectorRule("customCosmeticRules", hostname, selector);
  void recordRuleCreated("hide", hostname, selector);
  return result;
};
export const removeCustomCosmeticRule = async (hostname: string, selector: string): Promise<Settings> => {
  const result = await removeSelectorRule("customCosmeticRules", hostname, selector);
  void recordRuleRemoved("hide", hostname, selector);
  return result;
};
export const addGrayscaleRule = async (hostname: string, selector: string): Promise<Settings> => {
  const result = await addSelectorRule("customGrayscaleRules", hostname, selector);
  void recordRuleCreated("gray", hostname, selector);
  return result;
};
export const removeGrayscaleRule = async (hostname: string, selector: string): Promise<Settings> => {
  const result = await removeSelectorRule("customGrayscaleRules", hostname, selector);
  void recordRuleRemoved("gray", hostname, selector);
  return result;
};

/** Generates a random per-install seed the first time fingerprint resistance is turned on, then reuses it. */
export async function getOrCreateFingerprintSeed(): Promise<string> {
  const settings = await mutateSettings((current) =>
    current.fingerprintSeed ? null : { fingerprintSeed: crypto.randomUUID() }
  );
  return settings.fingerprintSeed;
}

const SESSION_FINGERPRINT_SEED_KEY = "sessionFingerprintSeed";

/**
 * Same idea as getOrCreateFingerprintSeed above, but stored in
 * browser.storage.session (in-memory, cleared when the browser or the
 * extension itself restarts) instead of local -- only used when
 * settings.fingerprintRotatePerSession is on. Storage.session's own
 * lifetime already gives "one seed per browser session" for free; no
 * onStartup bookkeeping needed here.
 */
// Same single-file-queue idea as `pending` above (and for the same reason):
// without serializing, two callers racing before the very first
// storage.session.set() lands (e.g. two tabs opened near-simultaneously
// right after a browser restart) would each read "nothing stored yet",
// each generate their own UUID, and each write -- clobbering one another
// and, worse, handing the two callers two different seeds, breaking the
// "one seed per browser session" guarantee this function exists for.
// Chaining through this queue means the second caller's read only happens
// after the first caller's write has landed, so it sees (and reuses) the
// seed the first caller just created instead of racing it.
let sessionSeedQueue: Promise<unknown> = Promise.resolve();

export function getOrCreateSessionFingerprintSeed(): Promise<string> {
  const result = sessionSeedQueue.then(async () => {
    const stored = await browser.storage.session.get(SESSION_FINGERPRINT_SEED_KEY);
    const existing = stored[SESSION_FINGERPRINT_SEED_KEY] as string | undefined;
    if (existing) return existing;
    const seed = crypto.randomUUID();
    await browser.storage.session.set({ [SESSION_FINGERPRINT_SEED_KEY]: seed });
    return seed;
  });
  sessionSeedQueue = result.catch(() => {});
  return result;
}
