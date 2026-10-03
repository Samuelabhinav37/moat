import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import { NETWORK_FLOWS, optionalFlowsOn, type FlowContext } from "./networkFlows";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const chrome: FlowContext = { firefox: false, managed: false, reports: false };

describe("NETWORK_FLOWS stays in step with the About page and the privacy policy", () => {
  it("has exactly one About row per flow", () => {
    const html = read("../options/options.html");
    const rows = [...html.matchAll(/class="flow-row"[^>]*data-flow="([a-z]+)"/g)].map((m) => m[1]);
    expect(rows.sort()).toEqual(NETWORK_FLOWS.map((flow) => flow.id).sort());
  });

  it("names every recipient in PRIVACY.md", () => {
    const policy = read("../../PRIVACY.md");
    for (const flow of NETWORK_FLOWS) {
      if (flow.recipient) expect(policy, `${flow.id} recipient`).toContain(flow.recipient);
    }
  });
});

describe("optionalFlowsOn", () => {
  it("is empty with the install defaults", () => {
    expect(optionalFlowsOn(DEFAULT_SETTINGS, chrome)).toEqual([]);
  });

  it("counts hidden-tracker lookups on Chrome, where they go to Cloudflare", () => {
    expect(optionalFlowsOn({ ...DEFAULT_SETTINGS, cnameUncloaking: true }, chrome)).toEqual(["hidden"]);
  });

  it("does not count them on Firefox, which uses its own DNS", () => {
    expect(optionalFlowsOn({ ...DEFAULT_SETTINGS, cnameUncloaking: true }, { ...chrome, firefox: true })).toEqual([]);
  });

  it("lists every optional flow that is on, in order", () => {
    const all = { ...DEFAULT_SETTINGS, cnameUncloaking: true, leakedPasswordCheck: true, syncEnabled: true };
    expect(optionalFlowsOn(all, chrome)).toEqual(["hidden", "breach", "sync"]);
  });
});
