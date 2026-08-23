import { getSettings, setSettings, setSiteDisabled } from "../background/settings";

const masterToggle = document.getElementById("master-toggle") as HTMLInputElement;
const cookiesToggle = document.getElementById("cookies-toggle") as HTMLInputElement;
const webrtcToggle = document.getElementById("webrtc-toggle") as HTMLInputElement;
const siteList = document.getElementById("site-list") as HTMLUListElement;
const emptyState = document.getElementById("empty-state") as HTMLParagraphElement;
const addInput = document.getElementById("add-input") as HTMLInputElement;
const addButton = document.getElementById("add-button") as HTMLButtonElement;

function normalizeHostname(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
}

async function render(): Promise<void> {
  const settings = await getSettings();
  masterToggle.checked = settings.enabled;
  cookiesToggle.checked = settings.blockThirdPartyCookies;
  webrtcToggle.checked = settings.webrtcLeakProtection;

  siteList.innerHTML = "";
  emptyState.style.display = settings.disabledSites.length ? "none" : "block";

  for (const hostname of [...settings.disabledSites].sort()) {
    const li = document.createElement("li");

    const label = document.createElement("span");
    label.textContent = hostname;

    const remove = document.createElement("button");
    remove.textContent = "Resume";
    remove.addEventListener("click", async () => {
      await setSiteDisabled(hostname, false);
      await render();
    });

    li.append(label, remove);
    siteList.append(li);
  }
}

masterToggle.addEventListener("change", async () => {
  await setSettings({ enabled: masterToggle.checked });
});

cookiesToggle.addEventListener("change", async () => {
  await setSettings({ blockThirdPartyCookies: cookiesToggle.checked });
});

webrtcToggle.addEventListener("change", async () => {
  await setSettings({ webrtcLeakProtection: webrtcToggle.checked });
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
