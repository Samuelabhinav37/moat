import { describe, expect, it } from "vitest";
import { lastSeenAfterInstalled, shouldShowUpdateNotice } from "../shared/updateNoticeLogic";

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

describe("lastSeenAfterInstalled", () => {
  it("records the baseline on a fresh install", () => {
    expect(lastSeenAfterInstalled("install", undefined, "1.0.0")).toBe("1.0.0");
  });

  it("leaves the old version on update, so the popup can show the notice", () => {
    expect(lastSeenAfterInstalled("update", "1.0.0", "1.1.0")).toBeUndefined();
    expect(shouldShowUpdateNotice("1.1.0", "1.0.0")).toBe(true);
  });

  it("leaves it on a browser update too", () => {
    expect(lastSeenAfterInstalled("browser_update", "1.0.0", "1.0.0")).toBeUndefined();
  });

  it("records a baseline when an older copy never stored one", () => {
    expect(lastSeenAfterInstalled("update", undefined, "1.1.0")).toBe("1.1.0");
  });
});
