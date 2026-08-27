// Isolated-world content script, YouTube only. In-stream video ads play
// through the same <video> element as real content, so they can't be
// network-blocked or cosmetically hidden without breaking the player --
// this dims them instead, using two DOM signals YouTube's own player
// already exposes, checked independently so either one alone is enough:
// (1) it toggles "ad-showing"/"ad-interrupting" on #movie_player while an
// ad plays, and (2) it populates .ytp-ad-module with the skip button/ad
// countdown UI for the same duration. Verified live against a real ad on
// a news livestream (2026-08-23): both signals fired together, and the
// video's computed filter came back grayscale(1) as expected. Checking
// both instead of just one means a future YouTube change has to break
// both signals at once to silently disable this, not just one.
//
// This is a first-party observation of YouTube's own markup, not a
// third-party script -- nothing here executes filter-list code (see the
// scriptlet discussion in README's "Known limitations"). Still a
// heuristic, not a guarantee: YouTube changes its DOM periodically, so
// this can stop matching without warning (Settings -> "Gray out
// unblockable video ads").
import browser from "webextension-polyfill";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import { STORAGE_KEY } from "../types";

const DIM_CLASS = "moat-ad-dim";
const STYLE_ELEMENT_ID = "moat-yt-ad-dim-style";
const AD_STATE_CLASSES = ["ad-showing", "ad-interrupting"];
const AD_MODULE_SELECTOR = ".ytp-ad-module";

async function isEnabled(): Promise<boolean> {
  const effective = await getEffectiveSettingsHere();
  return effective.grayscaleUnblockableAds && !isDisabled(effective);
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `#movie_player.${DIM_CLASS} video{filter:grayscale(1)!important;transition:filter .15s ease}`;
  document.documentElement.append(style);
}

function isAdShowing(player: Element): boolean {
  if (AD_STATE_CLASSES.some((cls) => player.classList.contains(cls))) return true;
  const adModule = player.querySelector(AD_MODULE_SELECTOR);
  return !!adModule && adModule.childElementCount > 0;
}

function syncDimState(player: Element): void {
  // Guard against a no-op write: toggling DIM_CLASS mutates player's class
  // attribute, which the observer below also watches -- only write when the
  // state actually flips, so a settled state can't retrigger itself.
  const showing = isAdShowing(player);
  if (player.classList.contains(DIM_CLASS) !== showing) {
    player.classList.toggle(DIM_CLASS, showing);
  }
}

// Every observer this file starts gets tracked here so stopWatching() (a
// setting flip, not a page unload) can tear all of them down -- nothing
// else in this file needs to know which observers exist at any given time.
let activeObservers: MutationObserver[] = [];
let playerWaitTimeout: ReturnType<typeof setTimeout> | null = null;
let watching = false;

const PLAYER_WAIT_TIMEOUT_MS = 15_000;

function watchPlayer(player: Element): void {
  let adModuleObserver: MutationObserver | null = null;

  function sync(): void {
    syncDimState(player);
    // .ytp-ad-module doesn't exist until the first ad ever loads, so this
    // attaches lazily the first time sync() sees it -- cheap once attached
    // (scoped to one small overlay element, not the whole player).
    if (!adModuleObserver) {
      const adModule = player.querySelector(AD_MODULE_SELECTOR);
      if (adModule) {
        adModuleObserver = new MutationObserver(sync);
        adModuleObserver.observe(adModule, { childList: true, subtree: true });
        activeObservers.push(adModuleObserver);
      }
    }
  }

  sync();
  const classObserver = new MutationObserver(sync);
  classObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
  activeObservers.push(classObserver);
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
      if (playerWaitTimeout !== null) {
        clearTimeout(playerWaitTimeout);
        playerWaitTimeout = null;
      }
      watchPlayer(player);
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  activeObservers.push(bodyObserver);

  // Most YouTube pages (search, channel, home) never have a player at all --
  // give up instead of paying full subtree-mutation cost on document.body
  // for the rest of the tab's lifetime.
  playerWaitTimeout = setTimeout(() => {
    bodyObserver.disconnect();
    playerWaitTimeout = null;
  }, PLAYER_WAIT_TIMEOUT_MS);
}

function startWatching(): void {
  if (watching) return;
  watching = true;
  ensureStyle();
  watchForPlayer();
}

function stopWatching(): void {
  watching = false;
  for (const observer of activeObservers) observer.disconnect();
  activeObservers = [];
  if (playerWaitTimeout !== null) {
    clearTimeout(playerWaitTimeout);
    playerWaitTimeout = null;
  }
}

async function run(): Promise<void> {
  if (await isEnabled()) startWatching();
}

// Settings.grayscaleUnblockableAds is only checked once at startup above --
// react live to it changing so switching it off in options.html actually
// stops the observers on an already-open tab instead of waiting for reload.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "managed" && !(area === "local" && STORAGE_KEY in changes)) return;
  void (async () => {
    if (await isEnabled()) startWatching();
    else stopWatching();
  })();
});

void run();
