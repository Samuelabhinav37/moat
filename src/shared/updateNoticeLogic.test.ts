import { describe, expect, it } from "vitest";
import { shouldShowUpdateNotice } from "../shared/updateNoticeLogic";

describe("shouldShowUpdateNotice", () => {
  it("is false on a fresh install, where there's no prior version to compare against", () => {
    expect(shouldShowUpdateNotice("1.0.0", undefined)).toBe(false);
  });

  it("is false when the version hasn't changed", () => {
    expect(shouldShowUpdateNotice("1.0.0", "1.0.0")).toBe(false);
  });

  it("is true when the version has changed", () => {
    expect(shouldShowUpdateNotice("1.1.0", "1.0.0")).toBe(true);
  });
});
