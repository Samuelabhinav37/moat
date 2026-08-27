import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, STORAGE_KEY, type Settings } from "../types";
import { PRESETS } from "../shared/filterPresets";
import { applyPrivacySettings } from "./privacySettings";
import { applyFilterGroupState } from "./filterGroups";
import { applyCustomRules } from "./applyCustomRules";
import { applyCnameUncloak } from "./cnameUncloak";
import { getManagedPolicy, applyManagedOverrides } from "./managedPolicy";
import { exportSettings } from "./settingsPortability";

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
  ]);
  applyCnameUncloak(effective);
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
      // happen for this install, same posture as everything else here that
      // isn't user-visible until it's turned on.
      void browser.storage.sync.set({ [STORAGE_KEY]: exportSettings(next) }).catch(() => {});
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
  return !settings.enabled || settings.disabledSites.includes(hostname);
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

export const addCustomCosmeticRule = (hostname: string, selector: string): Promise<Settings> =>
  addSelectorRule("customCosmeticRules", hostname, selector);
export const removeCustomCosmeticRule = (hostname: string, selector: string): Promise<Settings> =>
  removeSelectorRule("customCosmeticRules", hostname, selector);
export const addGrayscaleRule = (hostname: string, selector: string): Promise<Settings> =>
  addSelectorRule("customGrayscaleRules", hostname, selector);
export const removeGrayscaleRule = (hostname: string, selector: string): Promise<Settings> =>
  removeSelectorRule("customGrayscaleRules", hostname, selector);

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
export async function getOrCreateSessionFingerprintSeed(): Promise<string> {
  const stored = await browser.storage.session.get(SESSION_FINGERPRINT_SEED_KEY);
  const existing = stored[SESSION_FINGERPRINT_SEED_KEY] as string | undefined;
  if (existing) return existing;
  const seed = crypto.randomUUID();
  await browser.storage.session.set({ [SESSION_FINGERPRINT_SEED_KEY]: seed });
  return seed;
}
