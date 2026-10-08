import { describe, expect, it } from "vitest";
import { exposesExtensionAddress, splitFetchableRedirects } from "./fetchableRedirects.mjs";

const standIn = (id, condition) => ({ id, priority: 1, action: { type: "redirect", redirect: { extensionPath: "/r/noop.js" } }, condition });

describe("splitFetchableRedirects", () => {
  it("turns a fetch-only stand-in into a block", () => {
    const { rules, converted } = splitFetchableRedirects([standIn(5, { urlFilter: "||a.example^", resourceTypes: ["xmlhttprequest"] })]);
    expect(converted).toBe(1);
    expect(rules).toEqual([{ id: 5, priority: 1, action: { type: "block" }, condition: { urlFilter: "||a.example^", resourceTypes: ["xmlhttprequest"] } }]);
  });

  it("keeps the stand-in for other types and adds a fetch block with a fresh id", () => {
    const { rules, split } = splitFetchableRedirects([
      standIn(7, { urlFilter: "||a.example^", resourceTypes: ["script", "xmlhttprequest"] }),
      { id: 8, priority: 1, action: { type: "block" }, condition: { urlFilter: "||b.example^" } },
    ]);
    expect(split).toBe(1);
    expect(rules[0].condition.resourceTypes).toEqual(["script"]);
    expect(rules[1]).toEqual({ id: 9, priority: 1, action: { type: "block" }, condition: { urlFilter: "||a.example^", resourceTypes: ["xmlhttprequest"] } });
    expect(rules.some(exposesExtensionAddress)).toBe(false);
  });

  it("excludes fetch from a stand-in that lists no types", () => {
    const { rules } = splitFetchableRedirects([standIn(1, { urlFilter: "||a.example^", excludedResourceTypes: ["image"], initiatorDomains: ["x.example"] })]);
    expect(rules[0].condition).toEqual({ urlFilter: "||a.example^", initiatorDomains: ["x.example"], excludedResourceTypes: ["image", "xmlhttprequest"] });
    expect(rules[1].condition).toEqual({ urlFilter: "||a.example^", initiatorDomains: ["x.example"], resourceTypes: ["xmlhttprequest"] });
    expect(rules[1].action).toEqual({ type: "block" });
  });

  it("leaves other rules alone, including redirects that aren't stand-ins", () => {
    const strip = { id: 3, priority: 1, action: { type: "redirect", redirect: { transform: { queryTransform: { removeParams: ["utm"] } } } }, condition: {} };
    const scriptOnly = standIn(4, { urlFilter: "||a.example^", resourceTypes: ["script"] });
    expect(splitFetchableRedirects([strip, scriptOnly]).rules).toEqual([strip, scriptOnly]);
  });
});
