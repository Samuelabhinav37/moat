import { describe, expect, it } from "vitest";
import { DAY, shouldAskCheckin, weeksSince, type CheckinState } from "./checkinLogic";

const T0 = Date.UTC(2026, 9, 1);
const at = (days: number) => T0 + days * DAY;
const ask = (state: CheckinState, days: number, active = 7) => shouldAskCheckin(state, active, at(days));

describe("shouldAskCheckin", () => {
  const fresh: CheckinState = { installedAt: T0 };

  it("waits ten days after install", () => {
    expect(ask(fresh, 9)).toBe(false);
    expect(ask(fresh, 10)).toBe(true);
  });

  it("needs five days of real use", () => {
    expect(ask(fresh, 20, 4)).toBe(false);
    expect(ask(fresh, 20, 5)).toBe(true);
  });

  it("never asks without an install date or after Don't ask again", () => {
    expect(ask({}, 30)).toBe(false);
    expect(ask({ ...fresh, never: true }, 30)).toBe(false);
  });

  it("stays quiet for three days after a report, a pause or a stopped page", () => {
    expect(ask({ ...fresh, lastTroubleAt: at(18) }, 20)).toBe(false);
    expect(ask({ ...fresh, lastTroubleAt: at(17) }, 20)).toBe(true);
  });

  it("leaves two weeks between asks", () => {
    expect(ask({ ...fresh, asks: [at(10)] }, 23)).toBe(false);
    expect(ask({ ...fresh, asks: [at(10)] }, 24)).toBe(true);
  });

  it("asks at most three times a year", () => {
    const asks = [at(10), at(40), at(70)];
    expect(ask({ ...fresh, asks }, 100)).toBe(false);
    expect(ask({ ...fresh, asks }, 376)).toBe(true);
  });

  it("waits half a year after an answer", () => {
    expect(ask({ ...fresh, asks: [at(10)], answeredAt: at(10) }, 189)).toBe(false);
    expect(ask({ ...fresh, asks: [at(10)], answeredAt: at(10) }, 190)).toBe(true);
  });
});

describe("weeksSince", () => {
  it("counts whole weeks", () => {
    expect(weeksSince(T0, at(13))).toBe(1);
    expect(weeksSince(T0, at(14))).toBe(2);
    expect(weeksSince(undefined, at(14))).toBe(0);
  });
});
