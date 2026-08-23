import browser from "webextension-polyfill";
import type { GetStatusMessage, StatusResponse, ToggleSiteMessage } from "../types";

async function getStatus(): Promise<StatusResponse> {
  const message: GetStatusMessage = { type: "get-status" };
  return browser.runtime.sendMessage(message) as Promise<StatusResponse>;
}

async function render(): Promise<void> {
  const status = await getStatus();

  document.getElementById("count")!.textContent = String(status.blockedOnTab);
  document.getElementById("count-ads")!.textContent = String(status.breakdown.ads);
  document.getElementById("count-trackers")!.textContent = String(status.breakdown.trackers);
  document.getElementById("count-popups")!.textContent = String(status.breakdown.popups);

  const hostnameEl = document.getElementById("hostname")!;
  const siteCard = document.getElementById("site-card")!;
  const toggle = document.getElementById("site-toggle") as HTMLInputElement;
  const stats = document.getElementById("stats")!;
  const pausedBanner = document.getElementById("paused-banner")!;
  const pausedHostname = document.getElementById("paused-hostname")!;
  const siteState = document.getElementById("site-state")!;
  const siteStateText = document.getElementById("site-state-text")!;
  const reloadButton = document.getElementById("reload-page") as HTMLButtonElement;

  if (!status.hostname) {
    siteCard.style.display = "none";
    stats.hidden = false;
    return;
  }

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
  if (tab?.id !== undefined) await browser.tabs.sendMessage(tab.id, { type: "start-picker" }).catch(() => {});
  window.close();
});

void render();
