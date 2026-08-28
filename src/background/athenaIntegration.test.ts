import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { flushSecurityEvents, getAthenaSession, isAthenaConfigured, queueSecurityEvent } from "./athenaIntegration";
import type { AthenaConfig, ManagedPolicy } from "../types";

const sessionStore: Record<string, unknown> = {};

vi.mock("webextension-polyfill", () => {
  return {
    default: {
      storage: {
        session: {
          get: (key: string) => Promise.resolve(key in sessionStore ? { [key]: sessionStore[key] } : {}),
          set: (items: Record<string, unknown>) => {
            Object.assign(sessionStore, items);
            return Promise.resolve();
          },
        },
      },
      alarms: {
        create: () => Promise.resolve(),
        onAlarm: { addListener: () => {} },
      },
    },
  };
});

const CONFIG: AthenaConfig = {
  tenantId: "acme",
  agentId: "00000000-0000-4000-8000-000000000001",
  bootstrapUrl: "https://athena.acme.example/bootstrap",
  bootstrapSecret: "s3cret",
  eventsUrl: "https://athena.acme.example/events",
};

const CONFIGURED_POLICY: ManagedPolicy = { athena: CONFIG };

beforeEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
});

describe("isAthenaConfigured", () => {
  it("is false when no athena config is present at all", () => {
    expect(isAthenaConfigured({})).toBe(false);
  });

  it("is false when the athena object is missing a required field", () => {
    const partial: ManagedPolicy = { athena: { ...CONFIG, eventsUrl: "" } };
    expect(isAthenaConfigured(partial)).toBe(false);
  });

  it("is true when every required field is present", () => {
    expect(isAthenaConfigured(CONFIGURED_POLICY)).toBe(true);
  });

  it("is false when bootstrapUrl or eventsUrl isn't https (a misconfigured http:// endpoint would leak the secret/token)", () => {
    expect(isAthenaConfigured({ athena: { ...CONFIG, bootstrapUrl: "http://athena.acme.example/bootstrap" } })).toBe(false);
    expect(isAthenaConfigured({ athena: { ...CONFIG, eventsUrl: "http://athena.acme.example/events" } })).toBe(false);
  });
});

describe("getAthenaSession", () => {
  it("exchanges the bootstrap secret for a token on first call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok-1", expires_at: new Date(Date.now() + 3_600_000).toISOString() }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await getAthenaSession(CONFIG);
    expect(session).toEqual({ token: "tok-1", expiresAt: expect.any(Number) });
    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG.bootstrapUrl,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tenant_id: CONFIG.tenantId, agent_id: CONFIG.agentId, enrollment_secret: CONFIG.bootstrapSecret }),
      })
    );
  });

  it("reuses a cached, still-valid session instead of re-fetching", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok-2", expires_at: new Date(Date.now() + 3_600_000).toISOString() }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getAthenaSession(CONFIG);
    await getAthenaSession(CONFIG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cached session is within the expiry buffer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: "tok-3", expires_at: new Date(Date.now() + 1_000).toISOString() }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: "tok-4", expires_at: new Date(Date.now() + 3_600_000).toISOString() }) });
    vi.stubGlobal("fetch", fetchMock);

    const first = await getAthenaSession(CONFIG);
    const second = await getAthenaSession(CONFIG);
    expect(first?.token).toBe("tok-3");
    expect(second?.token).toBe("tok-4");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null without throwing when the bootstrap endpoint is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(getAthenaSession(CONFIG)).resolves.toBeNull();
  });

  it("returns null when the response body doesn't match the expected shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ unexpected: true }) }));
    await expect(getAthenaSession(CONFIG)).resolves.toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await expect(getAthenaSession(CONFIG)).resolves.toBeNull();
  });
});

describe("queueSecurityEvent / flushSecurityEvents", () => {
  it("does nothing at all when Athena isn't configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await queueSecurityEvent({}, { category: "security-rule", riskTier: "high" });
    await flushSecurityEvents({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches queued events and POSTs them with the bearer token on flush", async () => {
    const policy: ManagedPolicy = {
      athena: { ...CONFIG, tenantId: "acme-flush-1", eventsUrl: "https://athena.acme.example/events-1" },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === policy.athena!.bootstrapUrl) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: "tok", expires_at: new Date(Date.now() + 3_600_000).toISOString() }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueSecurityEvent(policy, { category: "security-rule", riskTier: "high", rulesetId: "ruleset_scam", ruleId: 7 });
    await queueSecurityEvent(policy, { category: "popup-redirect", riskTier: "medium" });
    await flushSecurityEvents(policy);

    const eventsCall = fetchMock.mock.calls.find((call: unknown[]) => call[0] === policy.athena!.eventsUrl);
    expect(eventsCall).toBeDefined();
    const [, init] = eventsCall as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string) as { source_event_id: string };
    expect(body.source_event_id).toBeTruthy();
  });

  it("keeps the queue for the next attempt when the flush POST fails", async () => {
    const policy: ManagedPolicy = {
      athena: { ...CONFIG, tenantId: "acme-flush-2", eventsUrl: "https://athena.acme.example/events-2" },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === policy.athena!.bootstrapUrl) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: "tok", expires_at: new Date(Date.now() + 3_600_000).toISOString() }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueSecurityEvent(policy, { category: "security-rule", riskTier: "high" });
    await flushSecurityEvents(policy);

    const key = "athenaEventQueue";
    const stored = (await browser.storage.session.get(key)) as Record<string, unknown[]>;
    expect(stored[key]).toHaveLength(1);
  });
});
