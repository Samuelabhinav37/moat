import { describe, expect, it } from "vitest";
import { MAX_FEEDBACK_NOTE, formatCheckin, formatGoodbye, isoWeek, validateCheckin, validateGoodbye } from "./feedback";

const checkin = { v: 1, score: "great", note: "", moatVersion: "0.11.287", browser: "Chrome 141", weeksSinceInstall: 3 };
const goodbye = { v: 1, reason: "broke-sites", note: "", moatVersion: "0.11.287" };

describe("validateCheckin", () => {
  it("accepts a plain answer and drops unknown fields", () => {
    const r = validateCheckin({ ...checkin, hostname: "example.com" });
    expect(r.ok && r.value).toEqual(checkin);
  });

  it("rejects anything else", () => {
    for (const patch of [{ score: "amazing" }, { note: "x".repeat(MAX_FEEDBACK_NOTE + 1) }, { moatVersion: "latest" }, { browser: "<b>" }, { weeksSinceInstall: -1 }, { weeksSinceInstall: 1.5 }, { v: 2 }]) {
      expect(validateCheckin({ ...checkin, ...patch }).ok, JSON.stringify(patch).slice(0, 40)).toBe(false);
    }
  });
});

describe("validateGoodbye", () => {
  it("accepts a reason, and a missing version", () => {
    expect(validateGoodbye(goodbye).ok).toBe(true);
    expect(validateGoodbye({ ...goodbye, moatVersion: "" }).ok).toBe(true);
  });

  it("rejects unknown reasons and versions", () => {
    expect(validateGoodbye({ ...goodbye, reason: "spam" }).ok).toBe(false);
    expect(validateGoodbye({ ...goodbye, moatVersion: "x" }).ok).toBe(false);
  });
});

describe("formatting", () => {
  it("keeps notes in a fenced block", () => {
    expect(formatCheckin({ ...checkin, score: "poor", note: "[click](https://x) @someone" } as never)).toBe("**Not well** · Moat 0.11.287 on Chrome 141 · week 3\n```text\n[click](https://x) @someone\n```");
    expect(formatGoodbye({ ...goodbye, reason: "slow", moatVersion: "" } as never)).toBe("**It slowed my browser** · Moat version unknown");
  });

  it("names ISO weeks", () => {
    expect(isoWeek(new Date(Date.UTC(2026, 9, 15)))).toBe("2026-W42");
    expect(isoWeek(new Date(Date.UTC(2027, 0, 1)))).toBe("2026-W53");
    expect(isoWeek(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-W01");
  });
});
