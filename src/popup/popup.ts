import browser from "webextension-polyfill";
import type { GetReportContextMessage, GetStatusMessage, ReportContextResponse, StatusResponse, ToggleSiteMessage } from "../types";
import { buildIssueUrl } from "./reportIssue";

async function getStatus(): Promise<StatusResponse> {
  const message: GetStatusMessage = { type: "get-status" };
  return browser.runtime.sendMessage(message) as Promise<StatusResponse>;
}

// Collapsed by default (see popup.html's <details hidden>) -- a company
// drill-down on top of the existing Ads/Trackers/Popups strip, not a
// dashboard. Hidden entirely when nothing's attributed rather than shown
// empty (most blocked requests have no company match -- TrackerDB only
// covers a fraction of the bundled domains).
function renderCompanyBreakdown(companyBreakdown: Record<string, number>): void {
  const details = document.getElementById("company-details")!;
  const list = document.getElementById("company-list")!;
  const entries = Object.entries(companyBreakdown).sort((a, b) => b[1] - a[1]);

  details.hidden = entries.length === 0;
  list.replaceChildren(
    ...entries.map(([company, count]) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = company;
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(count);
      li.append(name, n);
      return li;
    })
  );
}

async function render(): Promise<void> {
  const status = await getStatus();

  document.getElementById("count")!.textContent = String(status.blockedOnTab);
  document.getElementById("count-ads")!.textContent = String(status.breakdown.ads);
  document.getElementById("count-trackers")!.textContent = String(status.breakdown.trackers);
  document.getElementById("count-popups")!.textContent = String(status.breakdown.popups);
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
    siteStateText.textContent = paused ? "paused" : "protected";
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
  document.getElementById("site-card")!.textContent = "Couldn't load status. Try reopening the popup.";
});
