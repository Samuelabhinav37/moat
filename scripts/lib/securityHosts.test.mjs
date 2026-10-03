import { describe, expect, it } from "vitest";
import { buildSecurityHosts } from "./securityHosts.mjs";

const PAGE = ["main_frame", "sub_frame", "script"];
const manifest = [
  { id: "ruleset_phishing-urls-1", group: "phishing-urls", category: "security", file: "p1.json" },
  { id: "ruleset_phishing-urls-2", group: "phishing-urls", category: "security", file: "p2.json" },
  { id: "ruleset_ads-1", group: "ads", category: "ads", file: "a.json" },
];
const files = {
  "p1.json": [
    { action: { type: "block" }, condition: { requestDomains: ["Bad.example", "evil.test"], resourceTypes: PAGE } },
    { action: { type: "block" }, condition: { urlFilter: "||login-fake.example^", resourceTypes: PAGE } },
    { action: { type: "block" }, condition: { urlFilter: "||host.example/phish/page", resourceTypes: PAGE } },
  ],
  "p2.json": [
    // Can't stop a page load: no main_frame, or not a block.
    { action: { type: "block" }, condition: { requestDomains: ["script-only.example"], resourceTypes: ["script"] } },
    { action: { type: "allow" }, condition: { requestDomains: ["allowed.example"], resourceTypes: PAGE } },
    { action: { type: "block" }, condition: { urlFilter: "/ads/*", resourceTypes: PAGE } },
    // A suffix narrowed by a pattern blocks a few look-alikes, not all of .org.
    { action: { type: "block" }, condition: { regexFilter: "^https?://reddit-\d\.[a-z]{4}\.org/", requestDomains: ["org", "net"], resourceTypes: PAGE } },
    { action: { type: "block" }, condition: { urlFilter: "||org.gov-", resourceTypes: PAGE } },
  ],
  "a.json": [{ action: { type: "block" }, condition: { requestDomains: ["ads.example"], resourceTypes: PAGE } }],
};

describe("buildSecurityHosts", () => {
  it("collects page-blocking hosts per danger list, and nothing else", () => {
    expect(buildSecurityHosts(manifest, (f) => files[f])).toEqual({
      "phishing-urls": ["bad.example", "evil.test", "host.example", "login-fake.example"],
    });
  });
});
