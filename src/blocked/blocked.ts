// Moat's page for a whole site one of its lists stopped. See
// background/blockedPage.ts for how a tab gets here.
import browser from "webextension-polyfill";
import { applyStaticI18n } from "../shared/i18n";
import { CUSTOM_LIST, POLICY_LIST, UNKNOWN_LIST, destinationIn, parseBlockedPageQuery, type BlockKind } from "../shared/blockedPage";
import { LIST_LABELS } from "../options/filterListLabels";
import type { OpenBlockedPageMessage } from "../types";

const msg = (key: string, fallback: string, subs?: string | string[]): string => browser.i18n.getMessage(key, subs) || fallback;
applyStaticI18n(document, (key, subs) => browser.i18n.getMessage(key, subs));

/** What each danger list means for you, in a sentence. */
function dangerReason(list: string): string {
  switch (list) {
    case "phishing-urls":
      return msg("blockedWhyPhishing", "Moat's Phishing list says this is a fake sign-in page. It may try to steal your passwords or card details.");
    case "scam":
      return msg("blockedWhyScam", "Moat's Scams list says this is a scam site, like a fake shop or giveaway.");
    case "malicious-urls":
      return msg("blockedWhyMalware", "Moat's Malware list says this site spreads viruses.");
    case "badware":
      return msg("blockedWhyBadware", "Moat's Risky downloads list says this site offers bundled or fake software.");
    default:
      return msg("blockedWhyDanger", "It's on one of Moat's lists of dangerous sites.");
  }
}

function listName(list: string): string {
  if (list === CUSTOM_LIST) return msg("blockedListCustom", "Your block list");
  if (list === POLICY_LIST) return msg("blockedListPolicy", "Your organization's policy");
  const label = LIST_LABELS[list];
  if (label) return msg("blockedListNamed", `Moat's ${label.name} list`, msg(label.nameKey, label.name));
  return msg("blockedListUnknown", "One of Moat's lists");
}

function render(): void {
  const params = parseBlockedPageQuery(location.search);
  const kind: BlockKind = params?.kind ?? "ads";
  const list = params?.list ?? UNKNOWN_LIST;
  let host = "";
  try {
    host = params ? new URL(params.url).hostname : "";
  } catch {
    host = "";
  }
  document.body.dataset.kind = kind;

  const titles: Record<BlockKind, string> = {
    danger: msg("blockedTitleDanger", "This site may be dangerous"),
    ads: msg("blockedTitleAds", "Moat stopped this page"),
    custom: msg("blockedTitleCustom", "You blocked this site"),
    policy: msg("blockedTitlePolicy", "Your organization blocked this site"),
    unknown: msg("blockedTitleAds", "Moat stopped this page"),
  };
  const reasons: Record<BlockKind, string> = {
    danger: dangerReason(list),
    ads:
      list === UNKNOWN_LIST
        ? msg("blockedWhyAdsUnknown", "It's on one of Moat's lists of ad and tracker sites. Whole pages from these usually show only ads, or send you somewhere else.")
        : msg("blockedWhyAds", `It's on ${listName(list)}. Whole pages from these sites usually show only ads, or send you somewhere else.`, listName(list)),
    custom: msg("blockedWhyCustom", "It's on your own block list in Moat's settings."),
    policy: msg("blockedWhyPolicy", "Your organization's policy blocks it. Ask your IT team if you need it."),
    unknown: msg("blockedWhyUnknown", "It's on one of Moat's lists. Moat couldn't tell which one this time, so it may be a dangerous site."),
  };
  document.getElementById("title")!.textContent = titles[kind];
  document.title = host ? `${titles[kind]}: ${host}` : titles[kind];
  const why = document.getElementById("why")!;
  if (host) {
    why.append(Object.assign(document.createElement("span"), { className: "host", textContent: host }), document.createTextNode(". "));
  }
  why.append(document.createTextNode(reasons[kind]));

  document.getElementById("address")!.textContent = params?.url ?? "";
  document.getElementById("list-name")!.textContent = listName(list);

  const report = document.getElementById("report") as HTMLAnchorElement;
  report.hidden = kind === "policy" || !host;
  report.href = browser.runtime.getURL(`report.html?${new URLSearchParams({ site: host, reason: "false-alarm" }).toString()}`);
  const settingsLink = document.getElementById("settings-link") as HTMLAnchorElement;
  settingsLink.hidden = kind === "policy";
  settingsLink.textContent = kind === "custom" ? msg("blockedEditBlockList", "Edit your block list") : msg("blockedSeeLists", "See Moat's lists");
  settingsLink.href = browser.runtime.getURL(kind === "custom" ? "options.html#rules" : "options.html#filters");
  const helpLink = document.getElementById("help-link") as HTMLAnchorElement;
  helpLink.hidden = kind !== "danger";
  helpLink.href = browser.runtime.getURL("options.html#help/danger");

  // "Open anyway": plain for ads and your own blocks, behind Details for a
  // dangerous site, and not at all for an organization's block.
  document.getElementById("open-anyway")!.hidden = !params || (kind !== "ads" && kind !== "custom");
  // A stop Moat couldn't trace to a list gets the same care as a dangerous one.
  document.getElementById("danger-proceed")!.hidden = !params || (kind !== "danger" && kind !== "unknown");

  // An email or social click-link that was blocked as a tracker usually
  // carries the real address. Going there skips only the tracking hop, and
  // the destination still goes through Moat's lists.
  const destination = params && kind === "ads" ? destinationIn(params.url) : null;
  const goTo = document.getElementById("go-to") as HTMLButtonElement;
  goTo.hidden = !destination;
  if (destination) {
    const destinationHost = new URL(destination).hostname.replace(/^www\./, "");
    goTo.textContent = msg("blockedGoTo", `Go to ${destinationHost}`, destinationHost);
    goTo.addEventListener("click", () => location.assign(destination));
    document.getElementById("go-back")!.classList.remove("primary");
  }
}

/** Asks the worker to let this tab's blocked site through for one visit.
 * It loads the site itself; this page only hears back if it couldn't. */
async function openAnyway(): Promise<void> {
  const message: OpenBlockedPageMessage = { type: "open-blocked-page" };
  const opened = await browser.runtime.sendMessage(message).catch(() => false);
  if (opened !== true) {
    document.getElementById("details")!.hidden = false;
    document.getElementById("open-failed")!.hidden = false;
  }
}
document.getElementById("open-anyway")!.addEventListener("click", () => void openAnyway());
document.getElementById("open-dangerous")!.addEventListener("click", () => void openAnyway());

// The tab's history is [the page before, Chrome's error page for the
// blocked address, this page]. Going back one step would land on the error
// entry, which loads the blocked address again and comes straight back
// here, so "Go back" skips it. A tab that started on the blocked address
// has nothing to go back to, so the button closes the tab instead.
const canGoBack = history.length > 2;
const goBack = document.getElementById("go-back") as HTMLButtonElement;
if (!canGoBack) goBack.textContent = msg("blockedCloseTab", "Close tab");
goBack.addEventListener("click", () => {
  if (canGoBack) {
    history.go(-2);
    return;
  }
  void browser.tabs.getCurrent().then((tab) => (tab?.id !== undefined ? browser.tabs.remove(tab.id) : window.close()));
});

const details = document.getElementById("details")!;
const toggle = document.getElementById("show-details")!;
toggle.addEventListener("click", () => {
  details.hidden = !details.hidden;
  toggle.setAttribute("aria-expanded", String(!details.hidden));
});

render();
