// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { findBannerContainer, findConfidentRejectButton, runHeuristicFallback, type GeometryReader } from "./heuristicFallback";

beforeEach(() => {
  document.body.innerHTML = "";
});

// jsdom's getBoundingClientRect/getComputedStyle aren't representative (per
// adCollapse.test.ts's own note), so every geometry-dependent test passes an
// explicit fake rather than relying on jsdom's real layout.
function geometry(overrides: Partial<GeometryReader> = {}): GeometryReader {
  return {
    rectOf: () => ({ width: 100, height: 40 }),
    isVisible: () => true,
    ...overrides,
  };
}

describe("findBannerContainer", () => {
  it("finds a container mentioning cookies with a reject-family button", () => {
    document.body.innerHTML = `
      <div class="banner">
        <p>We use cookies to improve your experience.</p>
        <button>Accept all</button>
        <button>Reject all</button>
      </div>
    `;
    const container = findBannerContainer();
    expect(container).not.toBeNull();
    expect(container?.className).toBe("banner");
  });

  it("returns null when nothing mentions cookies/consent/gdpr", () => {
    document.body.innerHTML = `<div><button>Accept all</button><button>Reject all</button></div>`;
    expect(findBannerContainer()).toBeNull();
  });

  it("returns null when a banner-shaped container has no reject-family button", () => {
    document.body.innerHTML = `
      <div class="banner">
        <p>We use cookies to improve your experience.</p>
        <button>Accept all</button>
        <button>Manage settings</button>
      </div>
    `;
    expect(findBannerContainer()).toBeNull();
  });

  it("skips an implausibly large container (a whole-page wrapper) but still finds the nested banner", () => {
    const filler = "x".repeat(1600);
    document.body.innerHTML = `
      <div class="page">
        ${filler}
        <div class="banner">
          <p>This site uses cookies.</p>
          <button>Reject all</button>
        </div>
      </div>
    `;
    const container = findBannerContainer();
    expect(container?.className).toBe("banner");
  });

  it("prefers the tightest nested banner over an outer wrapper that also mentions cookies", () => {
    document.body.innerHTML = `
      <div class="outer">
        <p>Footer note: this site uses cookies. See our policy.</p>
        <div class="inner">
          <p>Cookie consent</p>
          <button>Reject all</button>
        </div>
      </div>
    `;
    const container = findBannerContainer();
    expect(container?.className).toBe("inner");
  });
});

describe("findConfidentRejectButton", () => {
  it("returns handled:true for exactly one visible, enabled reject-pattern button", () => {
    document.body.innerHTML = `<div id="c"><button>Accept all</button><button>Reject all</button></div>`;
    const container = document.getElementById("c")!;
    const result = findConfidentRejectButton(container, geometry());
    expect(result.handled).toBe(true);
    expect(result.rejectButton?.textContent).toBe("Reject all");
  });

  it("does not click when no reject-pattern button exists", () => {
    document.body.innerHTML = `<div id="c"><button>Accept all</button><button>Manage settings</button></div>`;
    const container = document.getElementById("c")!;
    const result = findConfidentRejectButton(container, geometry());
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/no reject-pattern/);
  });

  it("does not click when multiple conflicting reject-pattern buttons exist (ambiguous)", () => {
    document.body.innerHTML = `<div id="c"><button>Reject all</button><button>Decline</button></div>`;
    const container = document.getElementById("c")!;
    const result = findConfidentRejectButton(container, geometry());
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/ambiguous/);
  });

  it("does not click a disabled button", () => {
    document.body.innerHTML = `<div id="c"><button disabled>Reject all</button></div>`;
    const container = document.getElementById("c")!;
    const result = findConfidentRejectButton(container, geometry());
    expect(result.handled).toBe(false);
  });

  it("does not click a non-clickable element (a bare div, not a button/link/role=button)", () => {
    document.body.innerHTML = `<div id="c"><div>Reject all</div></div>`;
    const container = document.getElementById("c")!;
    const result = findConfidentRejectButton(container, geometry());
    expect(result.handled).toBe(false);
  });

  it("does not click when not visible", () => {
    document.body.innerHTML = `<div id="c"><button>Reject all</button></div>`;
    const container = document.getElementById("c")!;
    const result = findConfidentRejectButton(container, geometry({ isVisible: () => false }));
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/not visible/);
  });

  it("does not click when the matched element has zero rendered size", () => {
    document.body.innerHTML = `<div id="c"><button>Reject all</button></div>`;
    const container = document.getElementById("c")!;
    const result = findConfidentRejectButton(container, geometry({ rectOf: () => ({ width: 0, height: 0 }) }));
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/zero rendered size/);
  });

  it("still clicks a confident reject match even when accept renders much larger (the dark pattern this exists to see past)", () => {
    document.body.innerHTML = `<div id="c"><button class="a">Accept all</button><button class="r">Reject all</button></div>`;
    const container = document.getElementById("c")!;
    const geo = geometry({
      rectOf: (el) => (el.classList.contains("a") ? { width: 300, height: 80 } : { width: 20, height: 10 }),
    });
    const result = findConfidentRejectButton(container, geo);
    expect(result.handled).toBe(true);
    expect(result.dominance?.ratio).toBeGreaterThan(1);
  });

});

describe("runHeuristicFallback", () => {
  it("finds a banner, clicks its confident reject button, and reports handled:true", () => {
    document.body.innerHTML = `
      <div class="banner">
        <p>We use cookies.</p>
        <button class="accept">Accept all</button>
        <button class="reject">Reject all</button>
      </div>
    `;
    const rejectBtn = document.querySelector(".reject") as HTMLButtonElement;
    const onClick = vi.fn();
    rejectBtn.addEventListener("click", onClick);
    const result = runHeuristicFallback(document, geometry());
    expect(result.handled).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("reports handled:false and clicks nothing when no banner is present", () => {
    document.body.innerHTML = `<div><p>Ordinary page content.</p></div>`;
    const result = runHeuristicFallback(document, geometry());
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/no banner container/);
  });

  it("is safe to call repeatedly when no curated banner has mounted yet", () => {
    document.body.innerHTML = "";
    expect(() => runHeuristicFallback(document, geometry())).not.toThrow();
    expect(() => runHeuristicFallback(document, geometry())).not.toThrow();
  });
});
