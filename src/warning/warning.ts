// Only ever reached via a declarativeNetRequest redirect for a domain an
// org's Athena-pushed policy named (see athenaPolicyRules.ts) -- there is no
// way to navigate here from Moat's own bundled consumer filter lists, and
// this page does nothing at all for a normal, non-enterprise install.
import browser from "webextension-polyfill";
import type { AthenaBlockReasonResponse, GetAthenaBlockReasonMessage, ReportAthenaOverrideMessage } from "../types";

async function getBlockReason(): Promise<AthenaBlockReasonResponse> {
  const message: GetAthenaBlockReasonMessage = { type: "get-athena-block-reason" };
  return browser.runtime.sendMessage(message) as Promise<AthenaBlockReasonResponse>;
}

async function reportOverride(reason: string): Promise<void> {
  const message: ReportAthenaOverrideMessage = { type: "report-athena-override", reason };
  await browser.runtime.sendMessage(message);
}

async function render(): Promise<void> {
  const { hostname } = await getBlockReason();
  document.getElementById("hostname")!.textContent = hostname ?? "this page";
}

document.getElementById("go-back")!.addEventListener("click", () => {
  // Same "back to safety" pattern as a browser's own built-in phishing
  // interstitial -- the tab's history still holds whatever page the user
  // was on before following the link that led here.
  history.back();
});

document.getElementById("show-override")!.addEventListener("click", () => {
  document.getElementById("override-form")!.hidden = false;
  document.getElementById("show-override")!.hidden = true;
});

document.getElementById("submit-override")!.addEventListener("click", () => {
  void (async () => {
    const textarea = document.getElementById("reason") as HTMLTextAreaElement;
    const reason = textarea.value.trim();
    const status = document.getElementById("override-status")!;
    if (reason.length === 0) return;

    const submitButton = document.getElementById("submit-override") as HTMLButtonElement;
    submitButton.disabled = true;
    try {
      await reportOverride(reason);
      status.textContent = "Reported to your security team. This page stays blocked until they review it.";
    } catch {
      status.textContent = "Couldn't send the report -- try again in a moment.";
      submitButton.disabled = false;
    }
    status.hidden = false;
  })();
});

void render();
