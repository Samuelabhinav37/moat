// Isolated-world content script, Instagram + LinkedIn + YouTube. Everything
// else in this extension relies on a fixed selector (a filter-list rule, or
// a hand-picked one from the element picker) -- but infinite-scroll feeds
// on these sites render sponsored posts/cards with per-session, often
// randomized class names specifically to defeat exactly that kind of
// static rule (confirmed live for Instagram's atomic CSS classes and
// documented for LinkedIn's CSS-modules migration -- see README's "Known
// limitations"). A fixed selector can't follow that.
//
// This instead watches the feed the way a person would: it looks for the
// literal "Sponsored"/"Ad"/"Promoted"/"Paid partnership" label text next to
// a post as it renders, and hides the whole post/card once it finds one --
// a MutationObserver re-runs this on everything the feed adds as you
// scroll, not just what was there at page load. Matching is exact per
// segment (the label often shares a text node with adjacent metadata, e.g.
// "Sponsored · 2h" -- see feedAdLabel.ts), not a substring test, so a
// caption that happens to mention "sponsored" in a sentence won't trip it.
//
// This is opt-in and off by default: unlike a fixed selector, a text-label
// match can misfire if a site ever reuses that exact label for something
// else, and continuous scanning has a real (if small) cost on pages this
// mutation-heavy. Settings -> "Aggressively remove sponsored posts".
import browser from "webextension-polyfill";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import { findAdContainer, isAdLabel } from "./feedAdLabel";
import { STORAGE_KEY } from "../types";

const HIDE_CLASS = "moat-feed-ad-hidden";
const STYLE_ELEMENT_ID = "moat-feed-scanner-style";
const SCAN_DELAY_MS = 200;

async function isEnabled(): Promise<boolean> {
  const effective = await getEffectiveSettingsHere();
  return effective.aggressiveFeedAdRemoval && !isDisabled(effective);
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

let observer: MutationObserver | null = null;
let pendingRoots: Element[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function watchFeed(): void {
  if (observer) return; // already watching
  scanSubtree(document.body);

  const flush = (): void => {
    flushTimer = null;
    const roots = pendingRoots;
    pendingRoots = [];
    for (const root of roots) scanSubtree(root);
  };

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) pendingRoots.push(node);
      }
    }
    if (pendingRoots.length > 0 && flushTimer === null) {
      flushTimer = setTimeout(flush, SCAN_DELAY_MS);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopWatching(): void {
  observer?.disconnect();
  observer = null;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  pendingRoots = [];
}

async function run(): Promise<void> {
  if (!(await isEnabled())) return;
  ensureStyle();
  watchFeed();
}

// Settings.aggressiveFeedAdRemoval is only checked once at startup above --
// react live to it changing so switching it off in options.html actually
// stops the observer on an already-open tab instead of waiting for reload.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "managed" && !(area === "local" && STORAGE_KEY in changes)) return;
  void (async () => {
    if (await isEnabled()) {
      ensureStyle();
      watchFeed();
    } else {
      stopWatching();
    }
  })();
});

void run();
