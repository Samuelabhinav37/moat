import { describe, expect, it } from "vitest";
import { customRuleStatKey, isStale } from "./customRuleStats";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("customRuleStatKey", () => {
  it("distinguishes hide vs gray for the same hostname/selector", () => {
    expect(customRuleStatKey("hide", "example.com", ".ad")).not.toBe(customRuleStatKey("gray", "example.com", ".ad"));
  });

  it("distinguishes different hostnames or selectors", () => {
    expect(customRuleStatKey("hide", "example.com", ".ad")).not.toBe(customRuleStatKey("hide", "other.com", ".ad"));
    expect(customRuleStatKey("hide", "example.com", ".ad")).not.toBe(customRuleStatKey("hide", "example.com", ".ad2"));
  });
});

describe("isStale", () => {
  const now = Date.now();

  it("is not stale within 30 days of its last match", () => {
    expect(isStale({ lastMatchedAt: now - 10 * DAY_MS, createdAt: now - 60 * DAY_MS }, now)).toBe(false);
  });

  it("is stale more than 30 days after its last match", () => {
    expect(isStale({ lastMatchedAt: now - 31 * DAY_MS, createdAt: now - 60 * DAY_MS }, now)).toBe(true);
  });

  it("falls back to createdAt when it has never matched", () => {
    expect(isStale({ lastMatchedAt: null, createdAt: now - 31 * DAY_MS }, now)).toBe(true);
    expect(isStale({ lastMatchedAt: null, createdAt: now - 1 * DAY_MS }, now)).toBe(false);
  });
});
