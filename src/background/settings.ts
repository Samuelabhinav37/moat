import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, STORAGE_KEY, type Settings } from "../types";
import { applyPrivacySettings } from "./privacySettings";
import { applyFilterGroupState } from "./filterGroups";
import { applyCustomRules } from "./applyCustomRules";
import { applyCnameUncloak } from "./cnameUncloak";
import { getManagedPolicy, applyManagedOverrides } from "./managedPolicy";

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

async function applyEffectiveSettings(): Promise<void> {
  const effective = await getEffectiveSettings();
  await Promise.all([
    applyPrivacySettings(effective),
    applyFilterGroupState(effective),
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
    await applyEffectiveSettings();
    return next;
  });
  pending = result.catch(() => {});
  return result;
}

export function setSettings(patch: Partial<Settings>): Promise<Settings> {
  return mutateSettings(() => patch);
}

/** Re-applies everything against current settings -- call at startup, and whenever managed policy itself changes. */
export async function reapplySettings(): Promise<void> {
  await applyEffectiveSettings();
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
