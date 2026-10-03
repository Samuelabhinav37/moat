// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { openPauseMenu } from "./pauseMenu";

const labels = { title: "Pause Moat on a.example", hour: "For 1 hour", day: "For 1 day", always: "Until I turn it back on" };

describe("openPauseMenu", () => {
  let anchor: HTMLButtonElement;
  beforeEach(() => {
    document.body.innerHTML = "<div><button id='a'>switch</button></div>";
    anchor = document.getElementById("a") as HTMLButtonElement;
  });

  it("offers the three lengths, focuses the first, and reports the pick", () => {
    let picked: unknown = "none";
    openPauseMenu(document, anchor, labels, (c) => (picked = c));
    const items = [...document.querySelectorAll<HTMLButtonElement>(".pause-menu [role=menuitem]")];
    expect(items.map((b) => b.textContent)).toEqual(["For 1 hour", "For 1 day", "Until I turn it back on"]);
    expect(document.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    items[1]!.click();
    expect(picked).toBe("day");
    expect(document.querySelector(".pause-menu")).toBeNull();
  });

  it("cancels with Esc and gives focus back to the switch", () => {
    let picked: unknown = "none";
    openPauseMenu(document, anchor, labels, (c) => (picked = c));
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(picked).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("cancels on a click elsewhere", () => {
    let picked: unknown = "none";
    openPauseMenu(document, anchor, labels, (c) => (picked = c));
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(picked).toBeNull();
  });
});
