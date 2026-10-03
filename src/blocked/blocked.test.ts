// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// What Moat's block page says for each kind of stop, and where its links go.

const tabsRemove = vi.fn(async (_: number) => {});
vi.mock("webextension-polyfill", () => ({
  default: {
    i18n: { getMessage: () => "" },
    runtime: { getURL: (path: string) => `chrome-extension://moat/${path}` },
    tabs: { getCurrent: async () => ({ id: 9 }), remove: (id: number) => tabsRemove(id) },
  },
}));

const html = readFileSync(join(__dirname, "blocked.html"), "utf8");
const bodyHtml = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>")).replace(/^<body[^>]*>/, "");

async function openPage(query: string): Promise<void> {
  document.body.innerHTML = bodyHtml;
  window.history.replaceState(null, "", `/blocked.html${query}`);
  vi.resetModules();
  await import("./blocked");
}
const text = (id: string) => document.getElementById(id)!.textContent ?? "";
const q = (u: string, list: string, kind: string) => `?${new URLSearchParams({ u, list, kind }).toString()}`;

describe("blocked.html", () => {
  it("names the danger and the list for a phishing page", async () => {
    await openPage(q("https://paypa1-secure.top/login", "phishing-urls", "danger"));
    expect(document.body.dataset.kind).toBe("danger");
    expect(text("title")).toBe("This site may be dangerous");
    expect(text("why")).toBe("paypa1-secure.top. Moat's Phishing list says this is a fake sign-in page. It may try to steal your passwords or card details.");
    expect(text("list-name")).toBe("Moat's Phishing list");
    expect(text("address")).toBe("https://paypa1-secure.top/login");
    expect((document.getElementById("report") as HTMLAnchorElement).href).toBe("chrome-extension://moat/report.html?site=paypa1-secure.top&reason=false-alarm");
  });

  it("explains an ad list in plain words", async () => {
    await openPage(q("https://pop.example/", "popups", "ads"));
    expect(text("title")).toBe("Moat stopped this page");
    expect(text("why")).toContain("It's on Moat's Pop-up ads list.");
  });

  it("points a site on your own list to the list, and an organization's block to IT", async () => {
    await openPage(q("https://mine.example/", "custom", "custom"));
    expect(text("title")).toBe("You blocked this site");
    expect((document.getElementById("settings-link") as HTMLAnchorElement).href).toBe("chrome-extension://moat/options.html#rules");

    await openPage(q("https://work.example/", "policy", "policy"));
    expect(text("title")).toBe("Your organization blocked this site");
    expect(document.getElementById("report")!.hidden).toBe(true);
  });

  it("keeps Details closed until asked", async () => {
    await openPage(q("https://pop.example/", "ads", "ads"));
    const toggle = document.getElementById("show-details")!;
    expect(document.getElementById("details")!.hidden).toBe(true);
    toggle.click();
    expect(document.getElementById("details")!.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes the tab when there's no page to go back to", async () => {
    await openPage(q("https://pop.example/", "ads", "ads"));
    expect(text("go-back")).toBe("Close tab");
    document.getElementById("go-back")!.click();
    await vi.waitFor(() => expect(tabsRemove).toHaveBeenCalledWith(9));
  });

  it("shows a safe default for a query it doesn't trust", async () => {
    await openPage("?u=javascript:alert(1)&list=ads&kind=ads");
    expect(text("title")).toBe("Moat stopped this page");
    expect(text("address")).toBe("");
  });
});
