import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, STORAGE_KEY, type Settings } from "../types";
import { applyPrivacySettings } from "./privacySettings";
import { applyFilterGroupState } from "./filterGroups";
import { applyCustomRules } from "./applyCustomRules";
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

export async function addCustomCosmeticRule(hostname: string, selector: string): Promise<Settings> {
  const settings = await getSettings();
  const existing = settings.customCosmeticRules[hostname] ?? [];
  if (existing.includes(selector)) return settings;
  return setSettings({
    customCosmeticRules: { ...settings.customCosmeticRules, [hostname]: [...existing, selector] },
  });
}

export async function removeCustomCosmeticRule(hostname: string, selector: string): Promise<Settings> {
  const settings = await getSettings();
  const remaining = (settings.customCosmeticRules[hostname] ?? []).filter((s) => s !== selector);
  const next = { ...settings.customCosmeticRules };
  if (remaining.length > 0) {
    next[hostname] = remaining;
  } else {
    delete next[hostname];
  }
  return setSettings({ customCosmeticRules: next });
}

/** Generates a random per-install seed the first time fingerprint resistance is turned on, then reuses it. */
export async function getOrCreateFingerprintSeed(): Promise<string> {
  const settings = await getSettings();
  if (settings.fingerprintSeed) return settings.fingerprintSeed;
  const seed = crypto.randomUUID();
  await setSettings({ fingerprintSeed: seed });
  return seed;
}
