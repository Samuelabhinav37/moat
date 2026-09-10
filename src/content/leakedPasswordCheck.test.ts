// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    i18n: { getMessage: () => "" },
    storage: { onChanged: { addListener: () => {} } },
  },
}));

// checkPassword's only real dependency besides fetch -- stub both functions
// so importing the module doesn't touch the real settings/storage chain
// (see siteDisabled.ts's own module comment for why that chain exists).
vi.mock("./siteDisabled", () => ({
  getEffectiveSettingsHere: vi.fn().mockResolvedValue({ leakedPasswordCheck: true, enabled: true, disabledSites: [] }),
  isDisabled: () => false,
}));

async function importFresh() {
  vi.resetModules();
  return import("./leakedPasswordCheck");
}

function passwordInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "password";
  return input;
}

describe("checkPassword", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not mark a value as checked when the request fails, so the next attempt retries", async () => {
    const { checkPassword } = await importFresh();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const input = passwordInput();
    input.value = "correct-horse-battery-staple";

    await checkPassword(input);
    await checkPassword(input);

    // Same value, both calls hit the network -- a transient failure must
    // never permanently suppress future checks for this exact value.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not mark a value as checked when the response is non-2xx", async () => {
    const { checkPassword } = await importFresh();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const input = passwordInput();
    input.value = "correct-horse-battery-staple";

    await checkPassword(input);
    await checkPassword(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks a value as checked only after a successful response, skipping a repeat check", async () => {
    const { checkPassword } = await importFresh();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "AAAAA:1\nBBBBB:2" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const input = passwordInput();
    input.value = "correct-horse-battery-staple";

    await checkPassword(input);
    await checkPassword(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an empty value", async () => {
    const { checkPassword } = await importFresh();
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const input = passwordInput();
    input.value = "";

    await checkPassword(input);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
