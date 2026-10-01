// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { looksLikeConsentNode } from "./consentNode";

function el(html: string): Element {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  return wrap.firstElementChild!;
}

describe("looksLikeConsentNode", () => {
  it("matches banner text, ids and classes", () => {
    expect(looksLikeConsentNode(el("<div><p>We use cookies.</p></div>"))).toBe(true);
    expect(looksLikeConsentNode(el('<div id="onetrust-consent-sdk"></div>'))).toBe(true);
    expect(looksLikeConsentNode(el('<div class="gdpr-overlay"></div>'))).toBe(true);
  });

  it("matches any iframe (consent platforms often render in one)", () => {
    expect(looksLikeConsentNode(el('<iframe src="about:blank"></iframe>'))).toBe(true);
  });

  it("ignores ordinary content, a footer Privacy link, and text nodes", () => {
    expect(looksLikeConsentNode(el("<div><p>Story 12</p><a href='#'>Decline</a></div>"))).toBe(false);
    expect(looksLikeConsentNode(el("<footer><a href='/privacy'>Privacy</a></footer>"))).toBe(false);
    expect(looksLikeConsentNode(document.createTextNode("cookies"))).toBe(false);
  });
});
