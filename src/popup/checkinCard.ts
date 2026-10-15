// "How is Moat working for you?" in the popup, at most three times a year
// (shared/checkinLogic.ts decides when). One tap answers; a note is
// optional. The store link shows for every answer, so ratings are never
// steered by how someone answered. Sends only what's listed in
// shared/feedback.ts: the answer, the note, Moat's version, the browser and
// how many weeks Moat has been installed.
import browser from "webextension-polyfill";
import { getMessageOrFallback } from "../shared/i18n";
import { FEEDBACK_VERSION, validateCheckin, type CheckinScore } from "../shared/feedback";
import { REPORT_ENDPOINT } from "../shared/reportEndpoint";
import { storeReviewUrl } from "../shared/siteUrls";
import { browserLabel } from "../report/reportForm";
import { checkinDue, markCheckinAnswered, markCheckinAsked, markCheckinNever } from "../background/checkin";

const t = (key: string, fallback: string) => getMessageOrFallback((k, s) => browser.i18n.getMessage(k, s), key, fallback);

/** Shows the card when it's due, unless `quiet()` says the popup already
 * shows another notice (an update, the first-run card). The popup calls this
 * only on real sites, never on browser pages. */
export async function maybeShowCheckin(doc: Document, quiet: () => boolean): Promise<void> {
  if (!REPORT_ENDPOINT) return;
  const due = await checkinDue();
  if (!due.ask || quiet()) return;
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const card = $("checkin-card");
  const more = $("ck-more");
  const note = $<HTMLTextAreaElement>("ck-note");
  const status = $("ck-status");
  const send = $<HTMLButtonElement>("ck-send");
  let score: CheckinScore | null = null;

  const rate = $<HTMLAnchorElement>("ck-rate");
  const review = storeReviewUrl(navigator.userAgent);
  if (review) {
    rate.href = review;
    rate.hidden = false;
  }
  card.hidden = false;
  await markCheckinAsked();

  for (const button of card.querySelectorAll<HTMLButtonElement>("[data-score]")) {
    button.addEventListener("click", () => {
      score = button.dataset.score as CheckinScore;
      for (const b of card.querySelectorAll<HTMLButtonElement>("[data-score]")) b.setAttribute("aria-pressed", String(b === button));
      more.hidden = false;
      note.focus();
    });
  }

  $("ck-later").addEventListener("click", () => {
    card.hidden = true;
  });
  $("ck-never").addEventListener("click", () => {
    card.hidden = true;
    void markCheckinNever();
  });

  send.addEventListener("click", async () => {
    if (!score) return;
    const checked = validateCheckin({
      v: FEEDBACK_VERSION,
      score,
      note: note.value,
      moatVersion: browser.runtime.getManifest().version,
      browser: browserLabel(navigator.userAgent),
      weeksSinceInstall: due.weeksSinceInstall,
    });
    if (!checked.ok) return;
    send.disabled = true;
    try {
      const response = await fetch(`${REPORT_ENDPOINT}/checkin`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-moat-report": "1" },
        body: JSON.stringify(checked.value),
      });
      if (!response.ok) throw new Error(String(response.status));
      await markCheckinAnswered();
      $("ck-form").hidden = true;
      $("ck-thanks").hidden = false;
    } catch {
      send.disabled = false;
      status.textContent = t("checkinSendFailed", "Couldn't send. Try again later.");
    }
  });
}
