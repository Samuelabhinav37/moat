import { describe, expect, it } from "vitest";
import { answersPatch } from "./answers";
import { PRESETS } from "../shared/filterPresets";

describe("answersPatch", () => {
  it("changes nothing until something is answered", () => {
    expect(answersPatch({}, { ads: true })).toEqual({});
  });

  it("maps the wish to a level", () => {
    expect(answersPatch({ level: "strict" }, {})).toMatchObject({ enabled: true, fingerprintResistance: true, filterGroups: PRESETS.strict.filterGroups });
  });

  it("keeps the device disguise and cookie block off for people who get bot checks, even on Strict", () => {
    const patch = answersPatch({ level: "strict", botChecks: true }, {});
    expect(patch.fingerprintResistance).toBe(false);
    expect(patch.blockThirdPartyCookies).toBe(false);
    expect(answersPatch({ botChecks: false }, {})).toEqual({});
  });

  it("turns on page blocking only for people without a router blocker, on top of their lists", () => {
    expect(answersPatch({ routerBlocks: false }, { trackers: false })).toEqual({ filterGroups: { trackers: false, "ad-pages": true } });
    expect(answersPatch({ routerBlocks: true }, { "ad-pages": true })).toEqual({ filterGroups: { "ad-pages": false } });
    expect(answersPatch({ level: "lite", routerBlocks: false }, {}).filterGroups).toEqual({ ...PRESETS.lite.filterGroups, "ad-pages": true });
  });
});
