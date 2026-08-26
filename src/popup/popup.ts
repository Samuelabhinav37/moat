import browser from "webextension-polyfill";
import type {
  GetReportContextMessage,
  GetStatusMessage,
  GetUiNoticesMessage,
  ReportContextResponse,
  StatusResponse,
  ToggleSiteMessage,
} from "../types";
import { buildIssueUrl } from "./reportIssue";
import type { PopupUiNotices } from "../background/updateNotice";
import type { CompanyInfo } from "../shared/matchedRuleCompanies";
import { applyStaticI18n, getMessageOrFallback } from "../shared/i18n";

applyStaticI18n(document, (key, subs) => browser.i18n.getMessage(key, subs));

async function getStatus(): Promise<StatusResponse> {
  const message: GetStatusMessage = { type: "get-status" };
  return browser.runtime.sendMessage(message) as Promise<StatusResponse>;
}

// Both notices are "view = dismiss" -- shown once, then gone on the next
// open, with no explicit close button. A card the user has to click to
// dismiss is closer to a nag than one that's just gone next time.
async function renderUiNotices(): Promise<void> {
  const message: GetUiNoticesMessage = { type: "get-ui-notices" };
  const notices = (await browser.runtime.sendMessage(message)) as PopupUiNotices;

  const onboardingCard = document.getElementById("onboarding-card")!;
  if (notices.showOnboarding) {
    onboardingCard.hidden = false;
    void browser.runtime.sendMessage({ type: "dismiss-onboarding" });
  }

  const updateNotice = document.getElementById("update-notice")!;
  if (notices.updateAvailable) {
    document.getElementById("update-version")!.textContent = notices.updateVersion;
    updateNotice.hidden = false;
    void browser.runtime.sendMessage({ type: "dismiss-update-notice" });
  }
}

// Fetched only once a company row is actually clicked open, not on every
// popup open -- most opens never touch this, and the file (deduped, but
// still per-company text) is bigger than anything else the popup loads.
let companyInfoPromise: Promise<CompanyInfo> | null = null;
function loadCompanyInfo(): Promise<CompanyInfo> {
  companyInfoPromise ??= (async () => {
    try {
      const url = browser.runtime.getURL("rules/company-info.json");
      return (await (await fetch(url)).json()) as CompanyInfo;
    } catch {
      return {};
    }
  })();
  return companyInfoPromise;
}

// Ghostery-style click-through: a description/category/website link under a
// company row, same trust boundary as the count itself (TrackerDB data, no
// separate network request per company). Silently renders nothing if
// TrackerDB has no detail for this company beyond its name.
function renderCompanyDetail(container: HTMLElement, info: CompanyInfo[string] | undefined): void {
  container.replaceChildren();
  if (!info) return;
  if (info.description) {
    const description = document.createElement("p");
    description.className = "company-description";
    description.textContent = info.description;
    container.append(description);
  }
  if (info.category) {
    const category = document.createElement("p");
    category.className = "company-category";
    category.textContent = info.category.replace(/_/g, " ");
    container.append(category);
  }
  if (info.websiteUrl) {
    const link = document.createElement("a");
    link.href = info.websiteUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = getMessageOrFallback(
      (key) => browser.i18n.getMessage(key),
      "popupCompanyWebsite",
      "Website"
    );
    container.append(link);
  }
}

// Collapsed by default (see popup.html's <details hidden>) -- a company
// drill-down on top of the existing Ads/Trackers/Popups strip, not a
// dashboard. Hidden entirely when nothing's attributed rather than shown
// empty (most blocked requests have no company match -- TrackerDB only
// covers a fraction of the bundled domains). Each row is itself a
// click-through: expands a short description/category/link fetched from
// TrackerDB, same data Ghostery's Tracker Panel shows.
function renderCompanyBreakdown(companyBreakdown: Record<string, number>): void {
  const details = document.getElementById("company-details")!;
  const list = document.getElementById("company-list")!;
  const entries = Object.entries(companyBreakdown).sort((a, b) => b[1] - a[1]);

  details.hidden = entries.length === 0;
  list.replaceChildren(
    ...entries.map(([company, count]) => {
      const li = document.createElement("li");

      const row = document.createElement("button");
      row.type = "button";
      row.className = "company-row";
      const name = document.createElement("span");
      name.textContent = company;
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(count);
      row.append(name, n);

      const detail = document.createElement("div");
      detail.className = "company-detail";
      detail.hidden = true;

      row.addEventListener("click", () => {
        const expanding = detail.hidden;
        detail.hidden = !expanding;
        if (expanding && !detail.dataset.loaded) {
          detail.dataset.loaded = "1";
          void loadCompanyInfo().then((info) => renderCompanyDetail(detail, info[company]));
        }
      });

      li.append(row, detail);
      return li;
    })
  );
}

// A DuckDuckGo-report-card-style plain-language line over the exact same
// real block count already shown in the hero number below -- not a site
// safety/trust grade (Moat has no data on the site itself to grade), just a
// coarser, more legible framing of "how much did this page try to load."
function renderPageSummary(total: number): void {
  const summary = document.getElementById("page-summary")!;
  const [tier, key, fallback] =
    total === 0
      ? ["clean", "popupSummaryClean", "Nothing to block on this page"]
      : total < 10
        ? ["light", "popupSummaryLight", "A few trackers blocked"]
        : ["heavy", "popupSummaryHeavy", "Heavily tracked page"];
  summary.className = `summary ${tier}`;
  summary.textContent = getMessageOrFallback((key2) => browser.i18n.getMessage(key2), key, fallback);
}

async function render(): Promise<void> {
  const status = await getStatus();

  document.getElementById("count")!.textContent = String(status.blockedOnTab);
  document.getElementById("count-ads")!.textContent = String(status.breakdown.ads);
  document.getElementById("count-trackers")!.textContent = String(status.breakdown.trackers);
  document.getElementById("count-popups")!.textContent = String(status.breakdown.popups);
  renderPageSummary(status.blockedOnTab);
  renderCompanyBreakdown(status.companyBreakdown);

  const hostnameEl = document.getElementById("hostname")!;
  const siteCard = document.getElementById("site-card")!;
  const toggle = document.getElementById("site-toggle") as HTMLInputElement;
  const stats = document.getElementById("stats")!;
  const pausedBanner = document.getElementById("paused-banner")!;
  const pausedHostname = document.getElementById("paused-hostname")!;
  const siteState = document.getElementById("site-state")!;
  const siteStateText = document.getElementById("site-state-text")!;
  const reloadButton = document.getElementById("reload-page") as HTMLButtonElement;
  const reportButton = document.getElementById("report-problem") as HTMLButtonElement;

  if (!status.hostname) {
    siteCard.style.display = "none";
    stats.hidden = false;
    return;
  }

  reportButton.hidden = false;
  hostnameEl.textContent = status.hostname;
  pausedHostname.textContent = status.hostname;
  toggle.checked = !status.siteDisabled;
  toggle.disabled = !status.enabled;

  function setPaused(paused: boolean): void {
    stats.hidden = paused;
    pausedBanner.hidden = !paused;
    reloadButton.hidden = !paused;
    siteState.classList.toggle("paused", paused);
    siteStateText.textContent = getMessageOrFallback(
      (key) => browser.i18n.getMessage(key),
      paused ? "popupPaused" : "popupProtected",
      paused ? "paused" : "protected"
    );
  }

  setPaused(status.siteDisabled || !status.enabled);

  toggle.addEventListener("change", () => {
    const disabled = !toggle.checked;
    const message: ToggleSiteMessage = { type: "toggle-site", hostname: status.hostname, disabled };
    void browser.runtime.sendMessage(message);
    setPaused(disabled || !status.enabled);
  });

  reloadButton.addEventListener("click", async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) await browser.tabs.reload(tab.id);
    window.close();
  });
}

document.getElementById("open-options")?.addEventListener("click", (event) => {
  event.preventDefault();
  void browser.runtime.openOptionsPage();
});

document.getElementById("start-picker")?.addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    const tabId = tab.id;
    try {
      await browser.tabs.sendMessage(tabId, { type: "start-picker" });
    } catch {
      // No content script listening yet -- element-picker.js only
      // auto-injects on page load, so a tab left open since before the
      // extension was last installed/reloaded has no receiver. Inject it on
      // demand and retry once. This still no-ops on pages content scripts
      // can never run on (chrome://, the Web Store), which reject the
      // injection the same way.
      try {
        await browser.scripting.executeScript({ target: { tabId }, files: ["element-picker.js"] });
        await browser.tabs.sendMessage(tabId, { type: "start-picker" });
      } catch {
        // Nothing more we can do here.
      }
    }
  }
  window.close();
});

document.getElementById("report-problem")?.addEventListener("click", async () => {
  const message: GetReportContextMessage = { type: "get-report-context" };
  const context = (await browser.runtime.sendMessage(message)) as ReportContextResponse;
  const url = buildIssueUrl(context, browser.runtime.getManifest().version);
  await browser.tabs.create({ url });
  window.close();
});

void render().catch(() => {
  document.getElementById("site-card")!.textContent = getMessageOrFallback(
    (key) => browser.i18n.getMessage(key),
    "popupLoadError",
    "Couldn't load status. Try reopening the popup."
  );
});
void renderUiNotices();
