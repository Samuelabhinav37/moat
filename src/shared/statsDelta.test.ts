import { describe, expect, it } from "vitest";
import { NOTHING_RECORDED, unrecorded } from "./statsDelta";

describe("unrecorded", () => {
  it("records everything the first time", () => {
    const r = unrecorded(NOTHING_RECORDED, 8, { Google: 3 });
    expect(r.total).toBe(8);
    expect(r.counts).toEqual({ Google: 3 });
  });

  it("records only what's new on a later refresh of the same page", () => {
    const first = unrecorded(NOTHING_RECORDED, 8, { Google: 3 });
    const second = unrecorded(first.next, 27, { Google: 5, Amplitude: 2 });
    expect(second.total).toBe(19);
    expect(second.counts).toEqual({ Google: 2, Amplitude: 2 });
    expect(second.next).toEqual({ total: 27, counts: { Google: 5, Amplitude: 2 } });
  });

  it("records nothing when a refresh finds nothing new, or a lower number", () => {
    const first = unrecorded(NOTHING_RECORDED, 27, { Google: 5 });
    expect(unrecorded(first.next, 27, { Google: 5 })).toMatchObject({ total: 0, counts: {} });
    expect(unrecorded(first.next, 20, { Google: 4 })).toMatchObject({ total: 0, counts: {}, next: first.next });
  });
});
