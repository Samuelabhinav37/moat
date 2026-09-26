// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hostnameSegments, setBreakableHostname } from "./hostnameBreaks";

describe("hostnameSegments", () => {
  it("splits after each dot, keeping the dot on the left piece", () => {
    expect(hostnameSegments("www.theguardian.com")).toEqual(["www.", "theguardian.", "com"]);
  });

  it("leaves a dotless host whole", () => {
    expect(hostnameSegments("localhost")).toEqual(["localhost"]);
  });
});

describe("setBreakableHostname", () => {
  it("puts a <wbr> between pieces and keeps the visible text unchanged", () => {
    const el = document.createElement("div");
    el.textContent = "stale";
    setBreakableHostname(el, "theguardian.com");
    expect(el.innerHTML).toBe("theguardian.<wbr>com");
    expect(el.textContent).toBe("theguardian.com");
  });

  it("treats markup in the hostname as text", () => {
    const el = document.createElement("div");
    setBreakableHostname(el, "<b>x</b>.com");
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toBe("<b>x</b>.com");
  });
});
