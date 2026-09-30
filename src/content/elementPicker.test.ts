// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("webextension-polyfill", () => ({
  default: {
    i18n: { getMessage: () => "" },
    runtime: { sendMessage: (...args: unknown[]) => sendMessage(...args), onMessage: { addListener: () => {} } },
  },
}));

const picker = await import("./elementPicker");
const { generateSelector } = await import("./generateSelector");

function page(): { ad: HTMLElement; slot: HTMLElement } {
  document.body.innerHTML = `
    <main id="content">
      <p>Story text.</p>
      <section class="sidebar-ad-slot"><span>Advertisement</span><img class="ad-creative" src="x.png" /></section>
    </main>`;
  return { ad: document.querySelector<HTMLElement>(".ad-creative")!, slot: document.querySelector<HTMLElement>(".sidebar-ad-slot")! };
}

function buttons(root: ShadowRoot): Record<string, HTMLButtonElement> {
  const byText: Record<string, HTMLButtonElement> = {};
  for (const b of root.querySelectorAll("button")) byText[b.textContent!] = b;
  return byText;
}

beforeEach(() => {
  picker.teardown();
  sendMessage.mockClear();
  document.getElementById("moat-picker-style")?.remove();
});

describe("what was picked", () => {
  it("names elements in plain words", () => {
    const { ad, slot } = page();
    expect(picker.elementKind(ad)).toBe("image");
    expect(picker.elementKind(slot)).toBe("box");
    expect(picker.elementKind(document.createElement("iframe"))).toBe("frame");
    expect(picker.describeElement(ad)).toMatch(/^Image, \d+ × \d+$/);
  });

  it("walks out to each ancestor below body", () => {
    const { ad, slot } = page();
    expect(picker.selectionPath(ad)).toEqual([ad, slot, document.getElementById("content")]);
  });
});

describe("card position", () => {
  const viewport = { width: 1200, height: 800 };
  const card = { width: 320, height: 200 };
  it("goes below the element when it fits", () => {
    expect(picker.cardPosition({ top: 100, bottom: 300, left: 50 }, card, viewport)).toEqual({ top: 310, left: 50 });
  });
  it("goes above when there's no room below", () => {
    expect(picker.cardPosition({ top: 500, bottom: 700, left: 50 }, card, viewport)).toEqual({ top: 290, left: 50 });
  });
  it("stays inside the screen horizontally", () => {
    expect(picker.cardPosition({ top: 100, bottom: 300, left: 1100 }, card, viewport).left).toBe(1200 - 320 - 12);
  });
});

describe("starting one level up", () => {
  const sized = (el: Element, width: number, height: number) => {
    el.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  };

  it("starts at a wrapper that holds nothing but the clicked element", () => {
    document.body.innerHTML = `<main><p>Story</p><div class="box"><div class="ad"></div></div></main>`;
    const ad = document.querySelector(".ad")!;
    const box = document.querySelector(".box")!;
    sized(ad, 290, 252);
    sized(box, 320, 282);
    sized(document.querySelector("main")!, 1100, 900);
    const path = picker.selectionPath(ad);
    expect(path[picker.startingStep(path)]).toBe(box);
  });

  it("stays on the clicked element when the wrapper has other things in it or is much bigger", () => {
    document.body.innerHTML = `<div class="a"><span>Label</span><div class="ad"></div></div><div class="b"><div class="ad2"></div></div>`;
    const ad = document.querySelector(".ad")!;
    expect(picker.startingStep(picker.selectionPath(ad))).toBe(0);
    const ad2 = document.querySelector(".ad2")!;
    sized(ad2, 100, 100);
    sized(document.querySelector(".b")!, 400, 400);
    expect(picker.startingStep(picker.selectionPath(ad2))).toBe(0);
  });

  it("keeps Gray out folded under Details", () => {
    const { ad } = page();
    picker.startPicking();
    const root = picker.pickForTest(ad)!;
    expect(root.querySelector("details button")!.textContent).toBe("Gray out instead");
    expect(root.querySelector(".links")!.textContent).not.toContain("Gray out");
  });
});

describe("the hint", () => {
  it("has a Cancel button, so phones without an Esc key can stop picking", () => {
    page();
    const root = picker.startPicking()!;
    expect(root.querySelector(".pill")!.textContent).toContain("Press Esc to cancel");
    root.querySelector<HTMLButtonElement>(".pill-cancel")!.click();
    expect(document.querySelector("[data-moat-picker]")).toBeNull();
  });

  it("says tap, not click and Esc, on a touch screen", () => {
    page();
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query === "(hover: none)", media: query })) as unknown as typeof window.matchMedia;
    try {
      const root = picker.startPicking()!;
      expect(root.querySelector(".pill span")!.textContent).toBe("Tap anything to hide it.");
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("picking", () => {
  it("previews without saving, and Cancel puts the page back", () => {
    const { ad } = page();
    picker.startPicking();
    const root = picker.pickForTest(ad)!;
    expect(ad.style.getPropertyValue("opacity")).toBe("0.2");
    expect(root.textContent).toContain("Hide this?");
    // Plain words by default; the selector only inside Details.
    expect(root.querySelector(".what")!.textContent).toMatch(/^Image/);
    expect(root.querySelector("details")!.open).toBe(false);

    buttons(root)["Cancel"]!.click();
    expect(ad.style.getPropertyValue("opacity")).toBe("");
    expect(document.querySelector("[data-moat-picker]")).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("Select more and Select less step through the element's ancestors", () => {
    const { ad, slot } = page();
    picker.startPicking();
    const root = picker.pickForTest(ad)!;
    expect(buttons(root)["Select less"]!.disabled).toBe(true);
    buttons(root)["Select more"]!.click();
    expect(slot.style.getPropertyValue("opacity")).toBe("0.2");
    expect(ad.style.getPropertyValue("opacity")).toBe("");
    buttons(root)["Select less"]!.click();
    expect(ad.style.getPropertyValue("opacity")).toBe("0.2");
  });

  it("saves the same message as before when hiding on the site", () => {
    const { ad } = page();
    picker.startPicking();
    const root = picker.pickForTest(ad)!;
    const selector = generateSelector(ad);
    buttons(root)[`Hide on ${location.hostname}`]!.click();
    expect(sendMessage).toHaveBeenCalledWith({ type: "save-cosmetic-rule", hostname: location.hostname, selector });
    expect(document.getElementById("moat-picker-style")!.textContent).toContain(`${selector}{display:none!important}`);
  });

  it("hides just this time without saving, or grays out and saves that", () => {
    let { ad } = page();
    picker.startPicking();
    buttons(picker.pickForTest(ad)!)["Hide until reload"]!.click();
    expect(sendMessage).not.toHaveBeenCalled();

    ({ ad } = page());
    picker.startPicking();
    buttons(picker.pickForTest(ad)!)["Gray out instead"]!.click();
    expect(sendMessage).toHaveBeenCalledWith({ type: "save-grayscale-rule", hostname: location.hostname, selector: generateSelector(ad) });
  });

  it("Escape cancels", () => {
    const { ad } = page();
    picker.startPicking();
    picker.pickForTest(ad);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("[data-moat-picker]")).toBeNull();
    expect(ad.style.getPropertyValue("opacity")).toBe("");
  });
});
