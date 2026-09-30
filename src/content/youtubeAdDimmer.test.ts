// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The YouTube dimmer against a stand-in for YouTube's player markup: the two
// ad signals (the player's ad-showing class, a populated .ytp-ad-module),
// the setting and per-site pause, and turning off live.

const settings = { grayscaleUnblockableAds: true, paused: false };
const sendMessage = vi.fn(async (_: unknown) => {});
let onChanged: ((changes: Record<string, unknown>, area: string) => void) | null = null;

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: { sendMessage: (m: unknown) => sendMessage(m) },
    storage: { onChanged: { addListener: (fn: typeof onChanged) => (onChanged = fn) } },
  },
}));
vi.mock("./siteDisabled", () => ({
  getEffectiveSettingsHere: async () => ({ ...settings }),
  isDisabled: (s: typeof settings) => s.paused,
}));

const DIM = "moat-ad-dim";
const player = () => document.getElementById("movie_player")!;
const dimmed = () => player().classList.contains(DIM);

function addPlayer(): HTMLElement {
  const el = document.createElement("div");
  el.id = "movie_player";
  el.innerHTML = "<video></video>";
  document.body.append(el);
  return el;
}

async function load(): Promise<void> {
  vi.resetModules();
  await import("./youtubeAdDimmer");
  // run() awaits the settings once before it starts watching.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.documentElement.querySelectorAll("style").forEach((s) => s.remove());
  document.body.innerHTML = "";
  settings.grayscaleUnblockableAds = true;
  settings.paused = false;
  sendMessage.mockClear();
  onChanged = null;
  vi.useRealTimers();
});

describe("when the setting is on", () => {
  it("grays the video while the player says an ad is showing, and only then", async () => {
    addPlayer();
    await load();
    expect(dimmed()).toBe(false);

    player().classList.add("ad-showing");
    await vi.waitFor(() => expect(dimmed()).toBe(true));
    const style = document.getElementById("moat-yt-ad-dim-style")!;
    expect(style.textContent).toContain(`#movie_player.${DIM} video{filter:grayscale(1)`);

    player().classList.remove("ad-showing");
    await vi.waitFor(() => expect(dimmed()).toBe(false));
  });

  it("treats ad-interrupting the same way", async () => {
    addPlayer();
    await load();
    player().classList.add("ad-interrupting");
    await vi.waitFor(() => expect(dimmed()).toBe(true));
  });

  it("dims on the ad overlay alone, without the class", async () => {
    const el = addPlayer();
    const adModule = document.createElement("div");
    adModule.className = "ytp-ad-module";
    el.append(adModule);
    await load();
    expect(dimmed()).toBe(false);

    adModule.append(document.createElement("button"));
    // The overlay observer attaches on the next sync; a class change on the
    // player triggers one, the same as YouTube's own state changes do.
    player().classList.add("playing-mode");
    await vi.waitFor(() => expect(dimmed()).toBe(true));

    adModule.replaceChildren();
    await vi.waitFor(() => expect(dimmed()).toBe(false));
  });

  it("records one usage signal per ad, not per mutation", async () => {
    addPlayer();
    await load();
    player().classList.add("ad-showing");
    await vi.waitFor(() => expect(dimmed()).toBe(true));
    player().classList.add("something-else");
    player().classList.add("another");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "record-usage-signal", signal: "grayscaleAds" }));
  });

  it("finds a player that appears after the page loads", async () => {
    await load();
    addPlayer().classList.add("ad-showing");
    await vi.waitFor(() => expect(dimmed()).toBe(true));
  });

  it("stops looking for a player after 15 seconds", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    await import("./youtubeAdDimmer");
    await vi.advanceTimersByTimeAsync(15_001);
    addPlayer().classList.add("ad-showing");
    await vi.advanceTimersByTimeAsync(10);
    expect(dimmed()).toBe(false);
  });
});

describe("when it shouldn't run", () => {
  it("does nothing with the setting off", async () => {
    settings.grayscaleUnblockableAds = false;
    addPlayer();
    await load();
    player().classList.add("ad-showing");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dimmed()).toBe(false);
    expect(document.getElementById("moat-yt-ad-dim-style")).toBeNull();
  });

  it("does nothing on a site where Moat is paused", async () => {
    settings.paused = true;
    addPlayer();
    await load();
    player().classList.add("ad-showing");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dimmed()).toBe(false);
  });

  it("stops on an open tab when the setting is switched off, and starts again", async () => {
    addPlayer();
    await load();

    settings.grayscaleUnblockableAds = false;
    onChanged!({ settings: {} }, "local");
    await new Promise((resolve) => setTimeout(resolve, 0));
    player().classList.add("ad-showing");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dimmed()).toBe(false);

    player().classList.remove("ad-showing");
    settings.grayscaleUnblockableAds = true;
    onChanged!({ settings: {} }, "local");
    await new Promise((resolve) => setTimeout(resolve, 0));
    player().classList.add("ad-showing");
    await vi.waitFor(() => expect(dimmed()).toBe(true));
  });

  it("ignores storage changes that aren't its settings", async () => {
    addPlayer();
    await load();
    settings.grayscaleUnblockableAds = false;
    onChanged!({ somethingElse: {} }, "local");
    await new Promise((resolve) => setTimeout(resolve, 0));
    player().classList.add("ad-showing");
    await vi.waitFor(() => expect(dimmed()).toBe(true));
  });
});
