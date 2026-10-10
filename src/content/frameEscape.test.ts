import { describe, expect, it } from "vitest";
import { isFrameEscape, topSiteOf, type FrameContext } from "./frameEscape";

// The streamsgate.co case: top page, an embedme.st frame, then the
// xstream.st player frame where Adcash ran.
const player: FrameContext = {
  href: "https://xstream.st/livetv.php?stream=tv401878773",
  isTop: false,
  ancestorOrigins: ["https://embedme.st", "https://streamsgate.co"],
  referrer: "https://embedme.st/",
};

describe("topSiteOf", () => {
  it("uses the outermost ancestor, or the referrer where ancestors are missing", () => {
    expect(topSiteOf(player)).toBe("streamsgate.co");
    expect(topSiteOf({ ...player, ancestorOrigins: [] })).toBe("embedme.st");
    expect(topSiteOf({ ...player, ancestorOrigins: [], referrer: "" })).toBeNull();
  });
});

describe("isFrameEscape", () => {
  it("stops a cross-site frame opening a third site, the Adcash case", () => {
    expect(isFrameEscape("https://adblockerpremium.online/premium.php?gv=x", player)).toBe(true);
    expect(isFrameEscape("https://browserpro.online/opera/1056/", player)).toBe(true);
  });

  it("stops a blank window it could send anywhere afterwards", () => {
    expect(isFrameEscape("", player)).toBe(true);
    expect(isFrameEscape(undefined, player)).toBe(true);
    expect(isFrameEscape("about:blank", player)).toBe(true);
    expect(isFrameEscape("javascript:void(0)", player)).toBe(true);
  });

  it("lets a frame open its own site or the page's site", () => {
    expect(isFrameEscape("/fullscreen.php", player)).toBe(false);
    expect(isFrameEscape("https://cdn.xstream.st/help", player)).toBe(false);
    expect(isFrameEscape("https://www.streamsgate.co/schedule", player)).toBe(false);
  });

  it("leaves common embeds that open their own service alone", () => {
    const youtube: FrameContext = { href: "https://www.youtube.com/embed/abc", isTop: false, ancestorOrigins: ["https://news.example"], referrer: "" };
    expect(isFrameEscape("https://www.youtube.com/watch?v=abc", youtube)).toBe(false);
    const paypal: FrameContext = { href: "https://www.paypal.com/smart/buttons", isTop: false, ancestorOrigins: ["https://shop.example"], referrer: "" };
    expect(isFrameEscape("https://www.paypal.com/checkoutnow?token=1", paypal)).toBe(false);
  });

  it("doesn't apply to the top page, same-site frames, or frames it can't place", () => {
    expect(isFrameEscape("https://anything.example", { ...player, isTop: true })).toBe(false);
    const sameSite: FrameContext = { href: "https://player.streamsgate.co/x", isTop: false, ancestorOrigins: ["https://streamsgate.co"], referrer: "" };
    expect(isFrameEscape("https://ads.example/", sameSite)).toBe(false);
    expect(isFrameEscape("https://ads.example/", { ...player, ancestorOrigins: [], referrer: "" })).toBe(false);
    expect(isFrameEscape("https://ads.example/", { ...player, href: "about:blank" })).toBe(false);
  });
});
