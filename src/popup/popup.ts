import browser from "webextension-polyfill";
import type { GetStatusMessage, StatusResponse, ToggleSiteMessage } from "../types";

async function getStatus(): Promise<StatusResponse> {
  const message: GetStatusMessage = { type: "get-status" };
  return browser.runtime.sendMessage(message) as Promise<StatusResponse>;
}

async function render(): Promise<void> {
  const status = await getStatus();

  document.getElementById("count")!.textContent = String(status.blockedOnTab);

  const hostnameEl = document.getElementById("hostname")!;
  const siteCard = document.getElementById("site-card")!;
  const toggle = document.getElementById("site-toggle") as HTMLInputElement;

  if (!status.hostname) {
    siteCard.style.display = "none";
    return;
  }

  hostnameEl.textContent = status.hostname;
  toggle.checked = !status.siteDisabled;
  toggle.disabled = !status.enabled;

  toggle.addEventListener("change", () => {
    const message: ToggleSiteMessage = {
      type: "toggle-site",
      hostname: status.hostname,
      disabled: !toggle.checked,
    };
    void browser.runtime.sendMessage(message);
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
