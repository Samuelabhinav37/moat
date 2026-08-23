// Isolated-world content script, YouTube only. In-stream video ads play
// through the same <video> element as real content, so they can't be
// network-blocked or cosmetically hidden without breaking the player --
// this dims them instead, using the same DOM signal YouTube's own player
// already exposes: it toggles "ad-showing"/"ad-interrupting" on #movie_player
// while an ad plays. That's a first-party observation of YouTube's own
// markup, not a third-party script -- nothing here executes filter-list
// code (see the scriptlet discussion in README's "Known limitations").
//
// Best-effort by nature: YouTube changes its DOM periodically, so this can
// stop matching without warning. Off by default (Settings -> "Gray out
// unblockable video ads").
import browser from "webextension-polyfill";
import { isDisabledHere } from "./siteDisabled";
import { STORAGE_KEY, type Settings } from "../types";

const DIM_CLASS = "moat-ad-dim";
const STYLE_ELEMENT_ID = "moat-yt-ad-dim-style";
const AD_STATE_CLASSES = ["ad-showing", "ad-interrupting"];

async function isEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const settings = stored[STORAGE_KEY] as Partial<Settings> | undefined;
  return (settings?.grayscaleUnblockableAds ?? false) && !(await isDisabledHere());
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `#movie_player.${DIM_CLASS} video{filter:grayscale(1)!important;transition:filter .15s ease}`;
  document.documentElement.append(style);
}

function syncDimState(player: Element): void {
  const adShowing = AD_STATE_CLASSES.some((cls) => player.classList.contains(cls));
  player.classList.toggle(DIM_CLASS, adShowing);
}

function watchPlayer(player: Element): void {
  syncDimState(player);
  new MutationObserver(() => syncDimState(player)).observe(player, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

/** #movie_player is created once the watch page's player loads and (unlike
 * most of YouTube's SPA-navigated content) persists across video changes --
 * but stay watchful in case a future layout replaces it. */
function watchForPlayer(): void {
  const existing = document.getElementById("movie_player");
  if (existing) {
    watchPlayer(existing);
    return;
  }
  const bodyObserver = new MutationObserver(() => {
    const player = document.getElementById("movie_player");
    if (player) {
      bodyObserver.disconnect();
      watchPlayer(player);
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

async function run(): Promise<void> {
  if (!(await isEnabled())) return;
  ensureStyle();
  watchForPlayer();
}

void run();
