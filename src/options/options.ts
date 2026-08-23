import browser from "webextension-polyfill";
import {
  getEffectiveSettings,
  getSettings,
  removeCustomCosmeticRule,
  removeGrayscaleRule,
  setSettings,
  setSiteDisabled,
} from "../background/settings";
import { getManagedPolicy, isLocked } from "../background/managedPolicy";
import { getLiveUpdateStatus } from "../background/liveUpdates";
import { detectPreset, presetPatch, type PresetName } from "./filterPresets";
import { summarizeFilterLists, type RulesetManifestEntry } from "../shared/rulesetManifest";
import type { Settings } from "../types";

// ---------- Tabs ----------

const tabButtons = document.querySelectorAll<HTMLButtonElement>(".tab-button");
const tabPanels = document.querySelectorAll<HTMLElement>("[data-tab-panel]");

function selectTab(name: string): void {
  for (const button of tabButtons) button.setAttribute("aria-selected", String(button.dataset.tab === name));
  for (const panel of tabPanels) panel.hidden = panel.dataset.tabPanel !== name;
}

for (const button of tabButtons) {
  button.addEventListener("click", () => selectTab(button.dataset.tab!));
}

// ---------- Protection tab ----------

const masterToggle = document.getElementById("master-toggle") as HTMLInputElement;
const protectionLockedBadge = document.getElementById("protection-locked-badge") as HTMLElement;
const cookiesToggle = document.getElementById("cookies-toggle") as HTMLInputElement;
const webrtcToggle = document.getElementById("webrtc-toggle") as HTMLInputElement;
const fingerprintToggle = document.getElementById("fingerprint-toggle") as HTMLInputElement;
const grayscaleToggle = document.getElementById("grayscale-toggle") as HTMLInputElement;
const feedScanToggle = document.getElementById("feed-scan-toggle") as HTMLInputElement;
const liveStatus = document.getElementById("live-status") as HTMLElement;
const siteList = document.getElementById("site-list") as HTMLUListElement;
const siteEmptyState = document.getElementById("site-empty-state") as HTMLElement;
const addInput = document.getElementById("add-input") as HTMLInputElement;
const addButton = document.getElementById("add-button") as HTMLButtonElement;

function renderLiveStatus(status: Awaited<ReturnType<typeof getLiveUpdateStatus>>): void {
  if (!status) {
    liveStatus.textContent = "Not checked yet.";
    return;
  }
  const when = new Date(status.timestamp).toLocaleString();
  liveStatus.textContent = status.ok
    ? `Last updated ${when} — ${status.domainCount} domains.`
    : `Last attempt failed (${when}) — using the bundled baseline until the next try.`;
}

function normalizeHostname(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
}

/** Shared by the paused-sites list and the two custom block/allow lists. */
function renderDomainList(
  list: HTMLUListElement,
  emptyState: HTMLElement,
  domains: string[],
  removeLabel: string,
  onRemove: (domain: string) => Promise<void>
): void {
  list.innerHTML = "";
  emptyState.style.display = domains.length ? "none" : "block";

  for (const domain of [...domains].sort()) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = domain;

    const remove = document.createElement("button");
    remove.textContent = removeLabel;
    remove.addEventListener("click", async () => {
      await onRemove(domain);
      await render();
    });

    li.append(label, remove);
    list.append(li);
  }
}

// ---------- Filter Lists tab ----------

const presetRow = document.getElementById("preset-row") as HTMLElement;
const presetHint = document.getElementById("preset-hint") as HTMLElement;
const filtersLockedBadge = document.getElementById("filters-locked-badge") as HTMLElement;
const filterListRows = document.getElementById("filter-list-rows") as HTMLElement;

const PRESET_HINTS: Record<PresetName | "custom", string> = {
  off: "Nothing is blocked.",
  essential: "Ads, popups, and known-malicious sites only.",
  standard: "Essential, plus trackers and tracking-link cleanup.",
  strict: "Everything, plus the browser-wide privacy toggles above.",
  custom: "A mix you've put together yourself.",
};

const CATEGORY_LABELS: Record<RulesetManifestEntry["category"], string> = {
  ads: "Ads & trackers",
  security: "Security",
  annoyance: "Annoyances",
  core: "Core",
};

let manifestCache: RulesetManifestEntry[] | null = null;

async function loadRulesetManifest(): Promise<RulesetManifestEntry[]> {
  if (manifestCache) return manifestCache;
  const url = browser.runtime.getURL("rules/manifest.json");
  manifestCache = (await (await fetch(url)).json()) as RulesetManifestEntry[];
  return manifestCache;
}

async function renderFilterLists(settings: Settings): Promise<void> {
  const manifest = await loadRulesetManifest();
  const lists = summarizeFilterLists(manifest);

  const preset = detectPreset(settings);
  presetHint.textContent = PRESET_HINTS[preset];
  for (const button of presetRow.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === preset));
  }

  filterListRows.innerHTML = "";
  let lastCategory = "";
  for (const list of lists.sort((a, b) => a.category.localeCompare(b.category))) {
    if (list.category !== lastCategory) {
      const heading = document.createElement("div");
      heading.className = "filter-category";
      heading.textContent = CATEGORY_LABELS[list.category];
      filterListRows.append(heading);
      lastCategory = list.category;
    }

    const row = document.createElement("div");
    row.className = "row filter-row";

    const label = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = list.name;
    const count = document.createElement("div");
    count.className = "count";
    count.textContent = `${list.ruleCount.toLocaleString()} rules`;
    label.append(name, count);

    const toggle = document.createElement("label");
    toggle.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = settings.filterGroups[list.group] ?? true;
    const track = document.createElement("span");
    track.className = "track";
    track.innerHTML = '<span class="thumb"></span>';
    toggle.append(input, track);

    input.addEventListener("change", async () => {
      await setSettings({ filterGroups: { ...(await getSettings()).filterGroups, [list.group]: input.checked } });
      await render();
    });

    row.append(label, toggle);
    filterListRows.append(row);
  }
}

for (const button of presetRow.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  button.addEventListener("click", async () => {
    await setSettings(presetPatch(button.dataset.preset as PresetName));
    await render();
  });
}

// ---------- Custom Rules tab ----------

const customBlockList = document.getElementById("custom-block-list") as HTMLUListElement;
const customBlockEmpty = document.getElementById("custom-block-empty") as HTMLElement;
const customBlockInput = document.getElementById("custom-block-input") as HTMLInputElement;
const customBlockAdd = document.getElementById("custom-block-add") as HTMLButtonElement;

const customAllowList = document.getElementById("custom-allow-list") as HTMLUListElement;
const customAllowEmpty = document.getElementById("custom-allow-empty") as HTMLElement;
const customAllowInput = document.getElementById("custom-allow-input") as HTMLInputElement;
const customAllowAdd = document.getElementById("custom-allow-add") as HTMLButtonElement;

async function addCustomDomain(field: "customBlockedDomains" | "customAllowedDomains", input: HTMLInputElement): Promise<void> {
  const hostname = normalizeHostname(input.value);
  if (!hostname) return;
  const settings = await getSettings();
  const set = new Set(settings[field]);
  set.add(hostname);
  await setSettings({ [field]: [...set] });
  input.value = "";
  await render();
}

customBlockAdd.addEventListener("click", () => addCustomDomain("customBlockedDomains", customBlockInput));
customBlockInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") customBlockAdd.click();
});

customAllowAdd.addEventListener("click", () => addCustomDomain("customAllowedDomains", customAllowInput));
customAllowInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") customAllowAdd.click();
});

const hiddenElementList = document.getElementById("hidden-element-list") as HTMLUListElement;
const hiddenElementEmpty = document.getElementById("hidden-element-empty") as HTMLElement;
const grayscaleElementList = document.getElementById("grayscale-element-list") as HTMLUListElement;
const grayscaleElementEmpty = document.getElementById("grayscale-element-empty") as HTMLElement;

/** Shared by the picker's "Hide" and "Gray out" saved-rule lists -- both are
 * hostname -> selector[] maps rendered the same way. */
function renderSelectorRules(
  list: HTMLUListElement,
  emptyState: HTMLElement,
  rules: Record<string, string[]>,
  onRemove: (hostname: string, selector: string) => Promise<unknown>
): void {
  const rows = Object.entries(rules).flatMap(([hostname, selectors]) =>
    selectors.map((selector) => ({ hostname, selector }))
  );

  list.innerHTML = "";
  emptyState.style.display = rows.length ? "none" : "block";

  for (const { hostname, selector } of rows.sort((a, b) => a.hostname.localeCompare(b.hostname))) {
    const li = document.createElement("li");

    const label = document.createElement("span");
    label.textContent = `${hostname} — ${selector}`;

    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await onRemove(hostname, selector);
      await render();
    });

    li.append(label, remove);
    list.append(li);
  }
}

// ---------- About tab ----------

const versionText = document.getElementById("version-text") as HTMLElement;
const managedNotice = document.getElementById("managed-notice") as HTMLElement;

// ---------- Render ----------

async function render(): Promise<void> {
  const [settings, policy] = await Promise.all([getEffectiveSettings(), getManagedPolicy()]);

  const protectionLocked = isLocked("protection", policy);
  masterToggle.checked = settings.enabled;
  masterToggle.disabled = protectionLocked;
  protectionLockedBadge.hidden = !protectionLocked;

  cookiesToggle.checked = settings.blockThirdPartyCookies;
  webrtcToggle.checked = settings.webrtcLeakProtection;
  fingerprintToggle.checked = settings.fingerprintResistance;
  grayscaleToggle.checked = settings.grayscaleUnblockableAds;
  feedScanToggle.checked = settings.aggressiveFeedAdRemoval;
  renderLiveStatus(await getLiveUpdateStatus());

  renderDomainList(siteList, siteEmptyState, settings.disabledSites, "Resume", (hostname) =>
    setSiteDisabled(hostname, false).then(() => undefined)
  );

  const filtersLocked = isLocked("filterGroups", policy);
  filtersLockedBadge.hidden = !filtersLocked;
  for (const button of presetRow.querySelectorAll<HTMLButtonElement>("[data-preset]")) button.disabled = filtersLocked;
  await renderFilterLists(settings);
  for (const input of filterListRows.querySelectorAll("input")) input.disabled = filtersLocked;

  renderDomainList(customBlockList, customBlockEmpty, settings.customBlockedDomains, "Remove", async (domain) => {
    const current = await getSettings();
    await setSettings({ customBlockedDomains: current.customBlockedDomains.filter((d) => d !== domain) });
  });
  renderDomainList(customAllowList, customAllowEmpty, settings.customAllowedDomains, "Remove", async (domain) => {
    const current = await getSettings();
    await setSettings({ customAllowedDomains: current.customAllowedDomains.filter((d) => d !== domain) });
  });
  renderSelectorRules(hiddenElementList, hiddenElementEmpty, settings.customCosmeticRules, removeCustomCosmeticRule);
  renderSelectorRules(grayscaleElementList, grayscaleElementEmpty, settings.customGrayscaleRules, removeGrayscaleRule);

  versionText.textContent = `v${browser.runtime.getManifest().version}`;
  managedNotice.hidden = Object.keys(policy).length === 0;
}

masterToggle.addEventListener("change", async () => {
  await setSettings({ enabled: masterToggle.checked });
  await render();
});

cookiesToggle.addEventListener("change", async () => {
  await setSettings({ blockThirdPartyCookies: cookiesToggle.checked });
});

webrtcToggle.addEventListener("change", async () => {
  await setSettings({ webrtcLeakProtection: webrtcToggle.checked });
});

fingerprintToggle.addEventListener("change", async () => {
  await setSettings({ fingerprintResistance: fingerprintToggle.checked });
});

grayscaleToggle.addEventListener("change", async () => {
  await setSettings({ grayscaleUnblockableAds: grayscaleToggle.checked });
});

feedScanToggle.addEventListener("change", async () => {
  await setSettings({ aggressiveFeedAdRemoval: feedScanToggle.checked });
});

addButton.addEventListener("click", async () => {
  const hostname = normalizeHostname(addInput.value);
  if (!hostname) return;
  await setSiteDisabled(hostname, true);
  addInput.value = "";
  await render();
});

addInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addButton.click();
});

void render();
