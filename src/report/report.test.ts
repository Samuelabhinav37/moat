// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The report page's own behaviour: what it sends, when, and what it falls
// back to. The report's contents are covered in reportForm.test.ts and
// shared/problemReport tests; this is the page wiring around them.

const sendMessage = vi.fn(async (message: { type: string }) =>
  message.type === "get-report-context" ? { enabledFilterGroups: ["ads", "trackers"] } : undefined
);
const tabsGet = vi.fn(async (_: number) => ({ url: "https://www.example.com/article?id=7" }));
const tabsReload = vi.fn(async (_: number) => {});
const tabsCreate = vi.fn(async (_: { url: string }) => ({}));

vi.mock("webextension-polyfill", () => ({
  default: {
    i18n: { getMessage: () => "" },
    runtime: {
      getManifest: () => ({ version: "9.9.9", permissions: [] }),
      getURL: (path: string) => `chrome-extension://moat/${path}`,
      sendMessage: (m: { type: string }) => sendMessage(m),
    },
    tabs: {
      get: (id: number) => tabsGet(id),
      reload: (id: number) => tabsReload(id),
      create: (opts: { url: string }) => tabsCreate(opts),
    },
  },
}));
vi.mock("../background/settings", () => ({ getEffectiveSettings: async () => ({}) }));
vi.mock("../shared/filterPresets", () => ({ detectPreset: () => "standard" }));

const html = readFileSync(join(__dirname, "report.html"), "utf8");
const bodyHtml = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>")).replace(/^<body[^>]*>/, "");

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;
const sentCall = () => fetchMock.mock.calls[0]!;
const sentBody = () => JSON.parse(sentCall()[1].body as string);

async function openPage(query: string): Promise<void> {
  document.body.innerHTML = bodyHtml;
  window.history.replaceState(null, "", `/report.html${query}`);
  vi.resetModules();
  await import("./report");
  // init() awaits settings, the context message and tabs.get.
  await vi.waitFor(() => expect(document.getElementById("preview-text")!.textContent).not.toBe(""));
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function choose(name: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function submit(): void {
  $<HTMLFormElement>("report-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
const status = () => $("status").textContent ?? "";

beforeEach(() => {
  sendMessage.mockClear();
  tabsGet.mockClear();
  tabsReload.mockClear();
  tabsCreate.mockClear();
  fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: "R-123" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("opened from the popup for a tab", () => {
  it("shows the tab's site, offers to pause there, and previews the report", async () => {
    await openPage("?tab=5");
    expect(tabsGet).toHaveBeenCalledWith(5);
    expect($("site-fixed").hidden).toBe(false);
    expect($("site-name").textContent).toBe("example.com");
    expect($("site-input").hidden).toBe(true);
    expect($("pause-now").hidden).toBe(false);
    expect($("preview-text").textContent).toContain("example.com");
  });

  it("leaves the full page address out unless the box is ticked", async () => {
    await openPage("?tab=5");
    choose("category", "ads");
    submit();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = sentBody();
    expect(sent.hostname).toBe("example.com");
    expect(sent.url).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("article?id=7");
  });

  it("includes the address once the person ticks the box", async () => {
    await openPage("?tab=5");
    choose("category", "ads");
    $<HTMLInputElement>("include-url").checked = true;
    submit();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody().url).toBe("https://www.example.com/article?id=7");
  });

  it("pause pauses that site and reloads the tab", async () => {
    await openPage("?tab=5");
    $("pause-now").click();
    await vi.waitFor(() => expect(tabsReload).toHaveBeenCalledWith(5));
    expect(sendMessage).toHaveBeenCalledWith({ type: "toggle-site", hostname: "example.com", disabled: true, from: "report" });
    expect($("pause-now").hidden).toBe(true);
  });
});

describe("sending", () => {
  it("sends nothing until a category is chosen", async () => {
    await openPage("?tab=5");
    submit();
    await vi.waitFor(() => expect(status()).not.toBe(""));
    expect(fetchMock).not.toHaveBeenCalled();
    expect($("status").classList.contains("error")).toBe(true);
  });

  it("with no tab, needs a site typed in", async () => {
    await openPage("");
    expect($("site-input").hidden).toBe(false);
    expect($("pause-now").hidden).toBe(true);
    choose("category", "broken");
    submit();
    await vi.waitFor(() => expect(status()).not.toBe(""));
    expect(fetchMock).not.toHaveBeenCalled();

    $<HTMLInputElement>("site-input").value = "https://www.Example.org/page";
    submit();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody().hostname).toBe("example.org");
  });

  it("posts JSON to the report service and shows the reference", async () => {
    await openPage("?tab=5");
    choose("category", "cookie");
    submit();
    await vi.waitFor(() => expect($("done").hidden).toBe(false));
    const [url, init] = sentCall();
    expect(url).toMatch(/^https:\/\//);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json", "x-moat-report": "1" });
    expect($("done-ref").textContent).toBe("R-123");
    expect($("report-form").hidden).toBe(true);
  });

  it("when the service is busy, says so and offers copy and GitHub", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate" }), { status: 429 }));
    await openPage("?tab=5");
    choose("category", "ads");
    submit();
    await vi.waitFor(() => expect($("copy").hidden).toBe(false));
    expect($("github").hidden).toBe(false);
    expect($<HTMLButtonElement>("send").disabled).toBe(false);
    expect($("done").hidden).toBe(true);
    expect(status()).toMatch(/Too many reports/);
  });

  it("when sending fails, keeps the report and offers copy and GitHub", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await openPage("?tab=5");
    choose("category", "ads");
    submit();
    await vi.waitFor(() => expect($("copy").hidden).toBe(false));
    expect(status()).toMatch(/Couldn't send/);
    expect($("report-form").hidden).toBe(false);
  });

  it("a 200 without a reference counts as a failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await openPage("?tab=5");
    choose("category", "ads");
    submit();
    await vi.waitFor(() => expect($("copy").hidden).toBe(false));
    expect($("done").hidden).toBe(true);
  });

  it("GitHub opens a prefilled new issue", async () => {
    await openPage("?tab=5");
    choose("category", "ads");
    $("github").click();
    await vi.waitFor(() => expect(tabsCreate).toHaveBeenCalledTimes(1));
    const url = new URL(tabsCreate.mock.calls[0]![0].url);
    expect(url.pathname).toMatch(/\/issues\/new$/);
    expect(url.searchParams.get("body")).toContain("example.com");
  });
});

describe("opened from Settings › Security for a page Moat stopped", () => {
  it("fills in the site, picks 'Site broken or won't load' and writes the note", async () => {
    await openPage("?site=surveymonkey.com&reason=false-alarm");
    expect(tabsGet).not.toHaveBeenCalled();
    expect($<HTMLInputElement>("site-input").value).toBe("surveymonkey.com");
    expect(document.querySelector<HTMLInputElement>('input[name="category"][value="broken"]')!.checked).toBe(true);
    expect($<HTMLTextAreaElement>("note").value).toBe("Moat stopped this page from loading, but I think it's safe.");
    expect($("preview-text").textContent).toContain("surveymonkey.com");
  });
});
