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
      <section class="sidebar-ad-slot"><img class="ad-creative" src="x.png" /></section>
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

  it("Bigger and Smaller step through the element's ancestors", () => {
    const { ad, slot } = page();
    picker.startPicking();
    const root = picker.pickForTest(ad)!;
    expect(buttons(root)["Smaller"]!.disabled).toBe(true);
    buttons(root)["Bigger"]!.click();
    expect(slot.style.getPropertyValue("opacity")).toBe("0.2");
    expect(ad.style.getPropertyValue("opacity")).toBe("");
    buttons(root)["Smaller"]!.click();
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
    buttons(picker.pickForTest(ad)!)["Just this time"]!.click();
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
