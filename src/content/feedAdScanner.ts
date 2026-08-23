// Isolated-world content script, Instagram + YouTube. Everything else in
// this extension relies on a fixed selector (a filter-list rule, or a hand-
// picked one from the element picker) -- but infinite-scroll feeds on both
// sites render sponsored posts/cards with per-session, often randomized
// class names specifically to defeat exactly that kind of static rule (see
// README's "Known limitations"). A fixed selector can't follow that.
//
// This instead watches the feed the way a person would: it looks for the
// literal "Sponsored"/"Ad"/"Paid partnership" label text next to a post as
// it renders, and hides the whole post/card once it finds one -- a
// MutationObserver re-runs this on everything the feed adds as you scroll,
// not just what was there at page load. Matching is an exact, trimmed,
// case-insensitive match against a whole text node (not a substring check),
// so a caption that happens to mention "sponsored" in a sentence won't
// trip it -- only an isolated label node will.
//
// This is opt-in and off by default: unlike a fixed selector, a text-label
// match can misfire if a site ever reuses that exact label for something
// else, and continuous scanning has a real (if small) cost on pages this
// mutation-heavy. Settings -> "Aggressively remove sponsored posts".
import browser from "webextension-polyfill";
import { isDisabledHere } from "./siteDisabled";
import { findAdContainer, isAdLabel } from "./feedAdLabel";
import { STORAGE_KEY, type Settings } from "../types";

const HIDE_CLASS = "moat-feed-ad-hidden";
const STYLE_ELEMENT_ID = "moat-feed-scanner-style";
const SCAN_DELAY_MS = 200;

async function isEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const settings = stored[STORAGE_KEY] as Partial<Settings> | undefined;
  return (settings?.aggressiveFeedAdRemoval ?? false) && !(await isDisabledHere());
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `.${HIDE_CLASS}{display:none!important}`;
  document.documentElement.append(style);
}

function scanSubtree(root: Element): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const text = textNode.textContent;
    if (!text || !isAdLabel(text)) continue;

    const container = textNode.parentElement && findAdContainer(textNode.parentElement);
    if (container && !container.classList.contains(HIDE_CLASS)) {
      container.classList.add(HIDE_CLASS);
    }
  }
}

function watchFeed(): void {
  scanSubtree(document.body);

  let pendingRoots: Element[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    const roots = pendingRoots;
    pendingRoots = [];
    for (const root of roots) scanSubtree(root);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) pendingRoots.push(node);
      }
    }
    if (pendingRoots.length > 0 && timer === null) {
      timer = setTimeout(flush, SCAN_DELAY_MS);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function run(): Promise<void> {
  if (!(await isEnabled())) return;
  ensureStyle();
  watchFeed();
}

void run();
