// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PAGE, initDashboard, pageFromHash, showPage } from "./dashboard";

function page(): void {
  document.body.innerHTML = `
    <nav class="dash-nav">
      <a href="#blocking" data-page="blocking"><span class="nav-name">Blocking</span><span class="nav-lead" hidden>How much to block</span></a>
      <a href="#paused" data-page="paused"><span class="nav-name">Paused sites</span><span class="count" id="nav-count-paused" hidden></span><span class="nav-lead" hidden>Sites where ads load</span></a>
      <a href="#hidden" data-page="hidden"><span class="nav-name">Hidden on pages</span><span class="count" id="nav-count-hidden" hidden></span><span class="nav-lead" hidden>Parts you removed</span></a>
    </nav>
    <div class="page-head"><h1 id="page-title"></h1><p id="page-lead"></p></div>
    <div class="panel" id="main-panel">
      <section class="sec" data-page="blocking" id="level"><h2>How much to block</h2></section>
      <section class="sec" data-page="blocking" id="features"><h2>Features</h2></section>
      <section class="sec" data-page="paused" id="paused"><h2>Sites you've paused</h2><ul id="site-list"></ul></section>
      <section class="sec" data-page="hidden" id="hidden"><h2>Things you've hidden</h2><div id="hidden-element-rows"></div><div id="grayscale-element-rows"></div></section>
    </div>`;
}

const off = (id: string) => document.getElementById(id)!.classList.contains("dash-off");

beforeEach(page);

describe("pageFromHash", () => {
  it("reads a known screen and falls back to the first one otherwise", () => {
    expect(pageFromHash("#paused")).toBe("paused");
    expect(pageFromHash("filters")).toBe("filters");
    expect(pageFromHash("")).toBe(DEFAULT_PAGE);
    expect(pageFromHash("#nope")).toBe(DEFAULT_PAGE);
    expect(DEFAULT_PAGE).toBe("overview");
  });

  it("sends the old Trackers link to the Overview it was folded into", () => {
    expect(pageFromHash("#trackers")).toBe("overview");
  });
});

describe("showPage", () => {
  it("shows only the screen's sections and names it in the heading", () => {
    showPage("blocking");
    expect([off("level"), off("features"), off("paused"), off("hidden")]).toEqual([false, false, true, true]);
    expect(document.getElementById("page-title")!.textContent).toBe("Blocking");
    expect(document.getElementById("page-lead")!.textContent).toBe("How much to block");
    expect(document.querySelector('[aria-current="page"]')!.getAttribute("data-page")).toBe("blocking");
    expect(document.getElementById("level")!.classList.contains("dash-first")).toBe(true);
    expect(document.getElementById("level")!.classList.contains("dash-solo")).toBe(false);
  });

  it("uses a lone section's own sentence as the page subtitle", () => {
    document.getElementById("paused")!.insertAdjacentHTML("afterbegin", '<p class="lead">Ads load normally here.</p>');
    showPage("paused");
    expect(document.getElementById("page-lead")!.textContent).toBe("Ads load normally here.");
  });

  it("marks a lone section so its heading doesn't repeat the page title", () => {
    showPage("paused");
    expect(off("paused")).toBe(false);
    expect(off("level")).toBe(true);
    expect(document.getElementById("paused")!.classList.contains("dash-solo")).toBe(true);
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("hides a panel with nothing on this screen", () => {
    document.body.insertAdjacentHTML("beforeend", '<div class="panel" id="adv"><section class="sec" data-page="about"><h2>About</h2></section></div>');
    showPage("paused");
    expect(off("adv")).toBe(true);
    expect(off("main-panel")).toBe(false);
  });
});

describe("initDashboard", () => {
  it("opens the screen in the hash and follows hash changes", () => {
    window.location.hash = "#hidden";
    initDashboard(window);
    expect(off("hidden")).toBe(false);
    window.location.hash = "#paused";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(off("paused")).toBe(false);
    expect(off("hidden")).toBe(true);
  });

  it("keeps the sidebar counts in step with the lists", async () => {
    window.location.hash = "";
    initDashboard(window);
    const count = document.getElementById("nav-count-paused")!;
    expect(count.hidden).toBe(true);
    document.getElementById("site-list")!.innerHTML = "<li>a.example</li><li>b.example</li>";
    document.getElementById("grayscale-element-rows")!.innerHTML = "<div>.x</div>";
    await new Promise((r) => setTimeout(r, 0));
    expect(count.hidden).toBe(false);
    expect(count.textContent).toBe("2");
    expect(document.getElementById("nav-count-hidden")!.textContent).toBe("1");
  });
});
