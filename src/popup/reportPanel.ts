// Report a problem without leaving the popup: pick what's wrong, add a note
// if you like, Send. "What will be sent" shows the exact report first, and
// "More options" opens the full report page (copy, GitHub, a typed site).
import browser from "webextension-polyfill";
import { getMessageOrFallback } from "../shared/i18n";
import { reportLines, validateReport, type PauseAnswer, type ReportCategory } from "../shared/problemReport";
import { detectPreset } from "../shared/filterPresets";
import { SITE_URLS } from "../shared/siteUrls";
import { getEffectiveSettings } from "../background/settings";
import { browserLabel, buildReport, type ReportEnvironment } from "../report/reportForm";
import { sendReport } from "../report/sendReport";
import type { GetReportContextMessage, ReportContextResponse, ToggleSiteMessage } from "../types";

const t = (key: string, fallback: string, subs?: string | string[]) =>
  getMessageOrFallback((k, s) => browser.i18n.getMessage(k, s), key, fallback, subs);

export function initReportPanel(doc: Document): void {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const openButton = $<HTMLButtonElement>("report-problem");
  const main = doc.querySelector("main")!;
  const panel = $("report-panel");
  const form = $<HTMLFormElement>("rp-form");
  const note = $<HTMLTextAreaElement>("rp-note");
  const includeBlocked = $<HTMLInputElement>("rp-blocked");
  const blockedRow = $("rp-blocked-row");
  const includeUrl = $<HTMLInputElement>("rp-url");
  const preview = $("rp-preview");
  const status = $("rp-status");
  const send = $<HTMLButtonElement>("rp-send");
  const pauseNow = $<HTMLButtonElement>("rp-pause-now");

  let tabId: number | null = null;
  let hostname = "";
  let pageUrl: string | null = null;
  let blockedHosts: string[] = [];
  let env: ReportEnvironment = { moatVersion: browser.runtime.getManifest().version, browser: browserLabel(navigator.userAgent), level: "custom", lists: [] };

  const checked = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? null;
  const current = () =>
    buildReport(
      {
        category: (checked("rp-cat") ?? "other") as ReportCategory,
        hostname,
        pageUrl,
        includeUrl: includeUrl.checked,
        note: note.value,
        pausingFixes: (checked("rp-pause") ?? "untried") as PauseAnswer,
        blockedHosts,
        includeBlocked: includeBlocked.checked,
      },
      env
    );
  const refresh = () => {
    preview.textContent = reportLines(current());
    send.disabled = !checked("rp-cat");
  };
  const setStatus = (text: string, isError = false) => {
    status.textContent = text;
    status.classList.toggle("error", isError);
  };

  async function open(): Promise<void> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;
    if (!tab?.id || !url || !/^https?:$/.test(url.protocol)) return;
    tabId = tab.id;
    hostname = url.hostname.replace(/^www\./, "");
    pageUrl = url.href;
    $("rp-host").textContent = hostname;
    main.hidden = true;
    panel.hidden = false;
    refresh();
    (form.querySelector<HTMLInputElement>('input[name="rp-cat"]'))?.focus();
    const [settings, context] = await Promise.all([
      getEffectiveSettings(),
      browser.runtime.sendMessage({ type: "get-report-context", tabId } satisfies GetReportContextMessage) as Promise<ReportContextResponse>,
    ]);
    env = { ...env, level: detectPreset(settings), lists: context.enabledFilterGroups };
    blockedHosts = context.blockedHosts ?? [];
    blockedRow.hidden = blockedHosts.length === 0;
    $("rp-blocked-label").textContent = t("reportIncludeBlocked", `Include the addresses Moat blocked here (${blockedHosts.length})`, String(blockedHosts.length));
    refresh();
  }

  function close(): void {
    panel.hidden = true;
    main.hidden = false;
    openButton.focus();
  }

  openButton.addEventListener("click", () => {
    void open().catch(() => {
      openButton.textContent = t("popupReportError", "Couldn't open the report page. Try again.");
    });
  });
  $("rp-back").addEventListener("click", close);
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);

  pauseNow.addEventListener("click", async () => {
    if (tabId === null || !hostname) return;
    await browser.runtime.sendMessage({ type: "toggle-site", hostname, disabled: true, from: "report" } satisfies ToggleSiteMessage);
    await browser.tabs.reload(tabId).catch(() => {});
    pauseNow.hidden = true;
    setStatus(t("popupReportPausedHint", "Moat is paused here and the page reloaded. Check it, then answer above."));
  });

  $("rp-more").addEventListener("click", async (event) => {
    event.preventDefault();
    await browser.tabs.create({ url: browser.runtime.getURL(`report.html${tabId !== null ? `?tab=${tabId}` : ""}`) });
    window.close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!checked("rp-cat")) return setStatus(t("reportNeedCategory", "Choose what's wrong first."), true);
    const result = validateReport(current());
    if (!result.ok) return setStatus(t("reportInvalid", "Something in this report can't be sent. Try copying it instead."), true);
    send.disabled = true;
    setStatus(t("reportSending", "Sending…"));
    try {
      const id = await sendReport(result.report);
      form.hidden = true;
      $("rp-done-ref").textContent = id;
      $("rp-done").hidden = false;
      $<HTMLAnchorElement>("rp-support").href = SITE_URLS.support;
    } catch (error) {
      send.disabled = false;
      setStatus(
        (error as Error).message === "busy"
          ? t("reportBusy", "Too many reports right now. Wait a minute and send again, or copy the report.")
          : t("popupReportSendFailed", "Couldn't send. Try again, or use More options to copy it."),
        true
      );
    }
  });
}
