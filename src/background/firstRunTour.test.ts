import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const { shouldOpenFirstRunTour } = await import("./firstRunTour");

describe("shouldOpenFirstRunTour", () => {
  it("opens on a fresh install", () => {
    expect(shouldOpenFirstRunTour("install", "normal")).toBe(true);
    expect(shouldOpenFirstRunTour("install", "development")).toBe(true);
    expect(shouldOpenFirstRunTour("install", undefined)).toBe(true);
  });

  it("never opens on an update or a browser update", () => {
    expect(shouldOpenFirstRunTour("update", "normal")).toBe(false);
    expect(shouldOpenFirstRunTour("browser_update", "normal")).toBe(false);
  });

  it("stays closed when an organization installed Moat through policy", () => {
    expect(shouldOpenFirstRunTour("install", "admin")).toBe(false);
  });
});
