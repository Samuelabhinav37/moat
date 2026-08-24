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

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  await applyEffectiveSettings();
  return next;
}

/** Re-applies everything against current settings -- call at startup, and whenever managed policy itself changes. */
export async function reapplySettings(): Promise<void> {
  await applyEffectiveSettings();
}

export async function isSiteDisabled(hostname: string): Promise<boolean> {
  const settings = await getEffectiveSettings();
  return !settings.enabled || settings.disabledSites.includes(hostname);
}

export async function setSiteDisabled(hostname: string, disabled: boolean): Promise<Settings> {
  const settings = await getSettings();
  const set = new Set(settings.disabledSites);
  if (disabled) {
    set.add(hostname);
  } else {
    set.delete(hostname);
  }
  return setSettings({ disabledSites: [...set] });
}

type SelectorMapField = "customCosmeticRules" | "customGrayscaleRules";

/** Shared by the "Hide" and "Gray out" element-picker modes -- both are
 * hostname -> selector[] maps with identical add/remove semantics. */
async function addSelectorRule(field: SelectorMapField, hostname: string, selector: string): Promise<Settings> {
  const settings = await getSettings();
  const existing = settings[field][hostname] ?? [];
  if (existing.includes(selector)) return settings;
  return setSettings({ [field]: { ...settings[field], [hostname]: [...existing, selector] } } as Partial<Settings>);
}

async function removeSelectorRule(field: SelectorMapField, hostname: string, selector: string): Promise<Settings> {
  const settings = await getSettings();
  const remaining = (settings[field][hostname] ?? []).filter((s) => s !== selector);
  const next = { ...settings[field] };
  if (remaining.length > 0) {
    next[hostname] = remaining;
  } else {
    delete next[hostname];
  }
  return setSettings({ [field]: next } as Partial<Settings>);
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
  const settings = await getSettings();
  if (settings.fingerprintSeed) return settings.fingerprintSeed;
  const seed = crypto.randomUUID();
  await setSettings({ fingerprintSeed: seed });
  return seed;
}
