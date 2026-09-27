// Report a problem. Opened by the popup as report.html?tab=<id> for the site
// in that tab, or from Settings with no tab (the site is then typed in).
// Nothing is sent until the person presses Send, and "What will be sent"
// shows the exact report first. Without a report service configured
// (shared/reportEndpoint.ts), or if sending fails, the same report can be
// copied or opened as a GitHub issue instead.
import browser from "webextension-polyfill";
import { applyStaticI18n, getMessageOrFallback } from "../shared/i18n";
import { formatReport, reportLines, reportTitle, validateReport, type PauseAnswer, type ReportCategory } from "../shared/problemReport";
import { REPORT_ENDPOINT, REPORT_GITHUB_NEW_ISSUE } from "../shared/reportEndpoint";
import { detectPreset } from "../shared/filterPresets";
import { getEffectiveSettings } from "../background/settings";
import { browserLabel, buildReport, hostnameFromInput, type ReportEnvironment } from "./reportForm";
import { faviconUrl } from "../options/siteIcon";
import type { GetReportContextMessage, ReportContextResponse, ToggleSiteMessage } from "../types";

const t = (key: string, fallback: string, subs?: string | string[]) =>
  getMessageOrFallback((k, s) => browser.i18n.getMessage(k, s), key, fallback, subs);

applyStaticI18n(document, (key, subs) => browser.i18n.getMessage(key, subs));

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("report-form");
const siteFixed = $("site-fixed");
const siteName = $("site-name");
const siteIcon = $<HTMLImageElement>("site-icon");
const siteInput = $<HTMLInputElement>("site-input");
const note = $<HTMLTextAreaElement>("note");
const noteCount = $("note-count");
const includeUrlRow = $("include-url-row");
const includeUrl = $<HTMLInputElement>("include-url");
const pageUrlEl = $("page-url");
const previewText = $("preview-text");
const sendButton = $<HTMLButtonElement>("send");
const copyButton = $<HTMLButtonElement>("copy");
const githubButton = $<HTMLButtonElement>("github");
const statusEl = $("status");
const pauseNow = $<HTMLButtonElement>("pause-now");
const pauseStatus = $("pause-status");

const tabId = Number(new URLSearchParams(location.search).get("tab")) || null;
let tabHostname = "";
let pageUrl: string | null = null;
let env: ReportEnvironment = { moatVersion: browser.runtime.getManifest().version, browser: browserLabel(navigator.userAgent), level: "custom", lists: [] };

function checked(name: string): string | null {
  return form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? null;
}

function currentReport() {
  return buildReport(
    {
      category: (checked("category") ?? "other") as ReportCategory,
      hostname: tabHostname || hostnameFromInput(siteInput.value),
      pageUrl,
      includeUrl: includeUrl.checked,
      note: note.value,
      pausingFixes: (checked("pause") ?? "untried") as PauseAnswer,
    },
    env
  );
}

function refresh(): void {
  noteCount.textContent = `${note.value.length.toLocaleString()} / 2,000`;
  previewText.textContent = reportLines(currentReport());
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

/** Copy and GitHub stand in for Send when there's no report service, and
 * appear next to it when sending fails. */
function showFallbacks(): void {
  copyButton.hidden = false;
  githubButton.hidden = false;
}

async function init(): Promise<void> {
  const [settings, context] = await Promise.all([
    getEffectiveSettings(),
    browser.runtime.sendMessage({ type: "get-report-context" } satisfies GetReportContextMessage) as Promise<ReportContextResponse>,
  ]);
  env = { ...env, level: detectPreset(settings), lists: context.enabledFilterGroups };

  if (tabId !== null) {
    try {
      const tab = await browser.tabs.get(tabId);
      const url = tab.url ? new URL(tab.url) : null;
      if (url && /^https?:$/.test(url.protocol)) {
        tabHostname = url.hostname.replace(/^www\./, "");
        pageUrl = url.href;
        // The browser's own cached icon (Chrome's "favicon" permission):
        // no request to the site. Firefox has no such cache, so no icon.
        const supported = (browser.runtime.getManifest().permissions ?? []).includes("favicon");
        const icon = faviconUrl(tabHostname, (path) => browser.runtime.getURL(path), supported);
        if (icon) {
          siteIcon.src = icon;
          siteIcon.hidden = false;
        }
      }
    } catch {
      // The tab closed before the page opened: fall back to typing the site.
    }
  }
  if (tabHostname) {
    siteName.textContent = tabHostname;
    siteFixed.hidden = false;
    pageUrlEl.textContent = pageUrl ?? "";
    includeUrlRow.hidden = !pageUrl;
    pauseNow.hidden = false;
  } else {
    siteInput.hidden = false;
  }
  if (!REPORT_ENDPOINT) {
    sendButton.hidden = true;
    showFallbacks();
    // Without the private report service, GitHub is the way to send, and
    // issues there are public.
    $("preview-hint").textContent = t(
      "reportPreviewHintPublic",
      "Opening it on GitHub makes it a public issue there. Leave out anything you wouldn't post publicly."
    );
    setStatus(t("reportNoService", "Sending straight from Moat isn't set up in this version. Copy the report, or open it on GitHub."));
  }
  refresh();
}

form.addEventListener("input", refresh);
form.addEventListener("change", refresh);

pauseNow.addEventListener("click", async () => {
  if (!tabHostname || tabId === null) return;
  await browser.runtime.sendMessage({ type: "toggle-site", hostname: tabHostname, disabled: true } satisfies ToggleSiteMessage);
  await browser.tabs.reload(tabId).catch(() => {});
  pauseNow.hidden = true;
  pauseStatus.hidden = false;
  pauseStatus.textContent = t(
    "reportPausedHint",
    `Moat is paused on ${tabHostname} and the page reloaded. Check it, then answer above. Turn Moat back on from its icon when you're done.`,
    tabHostname
  );
});

async function problem(): Promise<string | null> {
  if (!checked("category")) return t("reportNeedCategory", "Choose what's wrong first.");
  const result = validateReport(currentReport());
  if (!result.ok) return result.error === "hostname" ? t("reportNeedSite", "Enter the site's address, like example.com.") : t("reportInvalid", "Something in this report can't be sent. Try copying it instead.");
  return null;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const issue = await problem();
  if (issue) return setStatus(issue, true);
  sendButton.disabled = true;
  setStatus(t("reportSending", "Sending…"));
  try {
    const response = await fetch(REPORT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-moat-report": "1" },
      body: JSON.stringify(currentReport()),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!response.ok || !body.id) throw new Error(response.status === 429 ? "busy" : body.error ?? String(response.status));
    form.hidden = true;
    $("done-ref").textContent = body.id;
    $("done").hidden = false;
  } catch (error) {
    sendButton.disabled = false;
    showFallbacks();
    setStatus(
      (error as Error).message === "busy"
        ? t("reportBusy", "Too many reports right now. Wait a minute and send again, or copy the report.")
        : t("reportSendFailed", "Couldn't send. Your report is still here, so you can send it again, copy it, or open it on GitHub."),
      true
    );
  }
});

copyButton.addEventListener("click", async () => {
  const report = currentReport();
  const text = `${reportTitle(report)}\n\n${formatReport(report)}`;
  try {
    await navigator.clipboard.writeText(text);
    setStatus(t("reportCopied", "Copied. Paste it wherever you'd like to send it."));
  } catch {
    previewText.textContent = text;
    ($("preview") as HTMLDetailsElement).open = true;
    setStatus(t("reportCopyManual", "Select the text under What will be sent and copy it."), true);
  }
});

githubButton.addEventListener("click", async () => {
  const issue = await problem();
  if (issue) return setStatus(issue, true);
  const report = currentReport();
  const params = new URLSearchParams({ title: reportTitle(report), body: formatReport(report) });
  await browser.tabs.create({ url: `${REPORT_GITHUB_NEW_ISSUE}?${params}` });
});

void init().catch(() => setStatus(t("reportLoadFailed", "Couldn't load Moat's details. You can still describe the problem and copy it."), true));
