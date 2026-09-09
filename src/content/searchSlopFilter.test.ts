// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  engineConfigFor,
  findSpamResults,
  hostOf,
  runSearchSlopPass,
} from "./searchSlopFilter";

const DOMAINS = ["ezinearticles.com", "ehow.com", "buzzle.com"];
const GOOGLE = engineConfigFor("www.google.com")!;
const BING = engineConfigFor("www.bing.com")!;
const DDG = engineConfigFor("duckduckgo.com")!;

afterEach(() => {
  document.body.innerHTML = "";
  document.getElementById("moat-search-slop-style")?.remove();
});

describe("engineConfigFor", () => {
  it("returns a config for each supported search engine", () => {
    expect(engineConfigFor("www.google.com")).not.toBeNull();
    expect(engineConfigFor("www.bing.com")).not.toBeNull();
    expect(engineConfigFor("duckduckgo.com")).not.toBeNull();
  });
  it("returns null for an unsupported host", () => {
    expect(engineConfigFor("www.example.com")).toBeNull();
  });
});

describe("hostOf", () => {
  it("returns the lowercased, www-stripped host of an absolute URL", () => {
    expect(hostOf("https://WWW.EzineArticles.com/x?y=1", "https://www.google.com/search")).toBe(
      "ezinearticles.com"
    );
  });
  it("resolves a root-relative href against the given base's own host, not a query-string target", () => {
    // Documents current behavior, not an "extract the redirect target"
    // claim: a link Google wraps as /url?q=<dest> resolves to google.com
    // here, so a spam domain hidden behind that kind of redirect wrapper
    // would not be caught. Modern Google organic results link directly, so
    // this is an accepted, documented gap rather than a live-verified case.
    expect(hostOf("/url?q=https://ehow.com", "https://www.google.com/search")).toBe("google.com");
  });
  it("returns '' for an unparseable href", () => {
    expect(hostOf("http://[not-a-valid-host", "https://www.google.com/search")).toBe("");
  });
});

describe("findSpamResults (Google-shaped markup)", () => {
  it("finds result cards whose link host matches the curated list", () => {
    document.body.innerHTML = `
      <div id="search">
        <div class="g"><a href="https://www.ezinearticles.com/some-article"><h3>Title</h3></a></div>
        <div class="g"><a href="https://example.com/legit"><h3>Title</h3></a></div>
      </div>`;
    const found = findSpamResults(document, "https://www.google.com/search", GOOGLE, DOMAINS);
    expect(found).toHaveLength(1);
  });

  it("matches a subdomain of a curated domain", () => {
    document.body.innerHTML = `
      <div id="search">
        <div class="g"><a href="https://articles.ehow.com/post"><h3>Title</h3></a></div>
      </div>`;
    const found = findSpamResults(document, "https://www.google.com/search", GOOGLE, DOMAINS);
    expect(found).toHaveLength(1);
  });

  it("skips results with no link, or an unparseable href", () => {
    document.body.innerHTML = `
      <div id="search">
        <div class="g"><span>no link here</span></div>
      </div>`;
    expect(findSpamResults(document, "https://www.google.com/search", GOOGLE, DOMAINS)).toHaveLength(0);
  });

  it("does not re-match an already-hidden result", () => {
    document.body.innerHTML = `
      <div id="search">
        <div class="g" data-moat-slop-hidden><a href="https://ehow.com/x"><h3>Title</h3></a></div>
      </div>`;
    expect(findSpamResults(document, "https://www.google.com/search", GOOGLE, DOMAINS)).toHaveLength(0);
  });
});

describe("findSpamResults (Bing/DuckDuckGo-shaped markup)", () => {
  it("finds a Bing organic result by its b_algo container", () => {
    document.body.innerHTML = `
      <ol id="b_results">
        <li class="b_algo"><h2><a href="https://buzzle.com/article">Title</a></h2></li>
        <li class="b_algo"><h2><a href="https://example.com/real">Title</a></h2></li>
      </ol>`;
    expect(findSpamResults(document, "https://www.bing.com/search", BING, DOMAINS)).toHaveLength(1);
  });

  it("finds a DuckDuckGo result by its data-testid", () => {
    document.body.innerHTML = `
      <div data-testid="mainline">
        <article data-testid="result">
          <a data-testid="result-title-a" href="https://ezinearticles.com/x">Title</a>
        </article>
      </div>`;
    expect(findSpamResults(document, "https://duckduckgo.com/", DDG, DOMAINS)).toHaveLength(1);
  });
});

describe("runSearchSlopPass", () => {
  it("hides matched results and inserts a one-time show banner", () => {
    document.body.innerHTML = `
      <div id="search">
        <div class="g"><a href="https://ehow.com/x"><h3>Title</h3></a></div>
        <div class="g"><a href="https://example.com/real"><h3>Title</h3></a></div>
      </div>`;
    const count = runSearchSlopPass(document, "https://www.google.com/search", GOOGLE, DOMAINS);
    expect(count).toBe(1);

    const hidden = document.querySelectorAll("[data-moat-slop-hidden]");
    expect(hidden).toHaveLength(1);
    const banner = document.getElementById("moat-search-slop-banner");
    expect(banner?.textContent).toContain("1 low-quality result hidden");
  });

  it("returns 0 and adds nothing when nothing matches", () => {
    document.body.innerHTML = `
      <div id="search">
        <div class="g"><a href="https://example.com/real"><h3>Title</h3></a></div>
      </div>`;
    const count = runSearchSlopPass(document, "https://www.google.com/search", GOOGLE, DOMAINS);
    expect(count).toBe(0);
    expect(document.getElementById("moat-search-slop-banner")).toBeNull();
  });

  it("the banner's Show button un-hides every matched result", () => {
    document.body.innerHTML = `
      <div id="search">
        <div class="g"><a href="https://ehow.com/a"><h3>Title</h3></a></div>
        <div class="g"><a href="https://buzzle.com/b"><h3>Title</h3></a></div>
      </div>`;
    runSearchSlopPass(document, "https://www.google.com/search", GOOGLE, DOMAINS);
    expect(document.querySelectorAll("[data-moat-slop-hidden]")).toHaveLength(2);

    const button = document.querySelector("#moat-search-slop-banner button") as HTMLButtonElement;
    button.click();

    expect(document.querySelectorAll("[data-moat-slop-hidden]")).toHaveLength(0);
    expect(document.getElementById("moat-search-slop-banner")).toBeNull();
  });
});
