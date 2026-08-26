import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetchWithRetry.mjs";

const okResponse = { ok: true, status: 200, statusText: "OK" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithRetry", () => {
  it("returns the response on a first-try success without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://example.com/x");

    expect(response).toBe(okResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 and succeeds once the upstream recovers", async () => {
    const badResponse = { ok: false, status: 503, statusText: "Service Unavailable" };
    const fetchMock = vi.fn().mockResolvedValueOnce(badResponse).mockResolvedValueOnce(okResponse);
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://example.com/x", { attempts: 3, baseDelayMs: 1 });

    expect(response).toBe(okResponse);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a thrown network error and eventually gives up, surfacing the last error", async () => {
    const err = new Error("ECONNRESET");
    const fetchMock = vi.fn().mockRejectedValue(err);
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithRetry("https://example.com/x", { attempts: 2, baseDelayMs: 1 })).rejects.toThrow(
      "ECONNRESET"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable 4xx status", async () => {
    const badResponse = { ok: false, status: 404, statusText: "Not Found" };
    const fetchMock = vi.fn().mockResolvedValue(badResponse);
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://example.com/x", { attempts: 3, baseDelayMs: 1 });

    expect(response).toBe(badResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
