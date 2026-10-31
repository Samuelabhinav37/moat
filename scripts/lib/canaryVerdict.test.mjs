import { describe, expect, it } from "vitest";
import { canaryVerdict } from "./canaryVerdict.mjs";

const run = (text, extra = {}) => ({ navErr: null, text, inputs: 10, title: "Shop", ...extra });

describe("canaryVerdict", () => {
  it("passes a site that renders the same", () => {
    expect(canaryVerdict([run(5000)], [run(4800)])).toEqual([]);
  });

  it("flags lost text only when every round agrees", () => {
    expect(canaryVerdict([run(5000), run(5100)], [run(900), run(4900)])).toEqual([]);
    expect(canaryVerdict([run(6200), run(2800)], [run(2800), run(2800)])).toEqual([]);
    expect(canaryVerdict([run(5000), run(5100)], [run(900), run(1200)])).toEqual(["text 1200/5000"]);
  });

  it("never counts a bot-wall page as lost text", () => {
    const wall = run(0, { inputs: 0, title: "forbes.com", wall: true });
    expect(canaryVerdict([run(18000), wall], [run(17500), wall])).toEqual([]);
    expect(canaryVerdict([wall, wall], [wall, wall])).toEqual([]);
    expect(canaryVerdict([run(18000), run(18000)], [wall, wall])).toEqual(["bot check"]);
  });

  it("ignores pages that were tiny in the baseline too", () => {
    expect(canaryVerdict([run(200)], [run(10)])).toEqual([]);
  });

  it("flags a failed load, a new bot check and missing controls", () => {
    expect(canaryVerdict([run(5000)], [run(0, { navErr: "Navigation timeout" })])).toEqual(["no load (Navigation timeout)"]);
    expect(canaryVerdict([run(5000)], [run(5000, { title: "Just a moment..." })])).toEqual(["bot check"]);
    expect(canaryVerdict([run(5000)], [run(5000, { inputs: 2 })])).toEqual(["controls 2/10"]);
  });

  it("doesn't blame the candidate when the baseline failed too", () => {
    const blocked = run(0, { navErr: "net::ERR_CONNECTION_RESET" });
    expect(canaryVerdict([blocked], [blocked])).toEqual([]);
    expect(canaryVerdict([run(80, { title: "Just a moment..." })], [run(80, { title: "Just a moment..." })])).toEqual([]);
  });
});
