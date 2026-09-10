// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  engineConfigFor,
  findSpamResults,
  hostFromCiteText,
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

  // Live-verified against real search-results pages: a card can hold more
  // than one <a href>, and the intended "title link" isn't necessarily the
  // first one in document order.
  it("picks the result-title-a link, not an earlier same-page refinement link, on DuckDuckGo", () => {
    document.body.innerHTML = `
      <div data-testid="mainline">
        <article data-testid="result">
          <a href="?q=site%3Aehow.com">More from ehow.com</a>
          <a data-testid="result-title-a" href="https://example.com/real">Title</a>
        </article>
      </div>`;
    // The refinement link resolves to duckduckgo.com itself (relative to
    // base), which would never match the curated list anyway -- the real
    // regression this guards is picking the WRONG host at all, verified
    // directly by asserting on a curated-domain refinement link below.
    expect(findSpamResults(document, "https://duckduckgo.com/", DDG, DOMAINS)).toHaveLength(0);

    document.body.innerHTML = `
      <div data-testid="mainline">
        <article data-testid="result">
          <a href="?q=site%3Aehow.com">More from ehow.com</a>
          <a data-testid="result-title-a" href="https://ehow.com/real-article">Title</a>
        </article>
      </div>`;
    expect(findSpamResults(document, "https://duckduckgo.com/", DDG, DOMAINS)).toHaveLength(1);
  });

  it("picks the h2 title link, not an earlier unrelated anchor, on Bing", () => {
    document.body.innerHTML = `
      <ol id="b_results">
        <li class="b_algo">
          <a href="#">skip to content</a>
          <h2><a href="https://ehow.com/article">Title</a></h2>
        </li>
      </ol>`;
    expect(findSpamResults(document, "https://www.bing.com/search", BING, DOMAINS)).toHaveLength(1);
  });

  it("falls back to the citation text on Bing when the title link is a same-origin redirect wrapper", () => {
    // Live-verified: Bing wraps every result's href in its own click-
    // tracking redirect (resolves to bing.com, not the real destination) --
    // the actual host is only ever exposed as the citation element's text.
    document.body.innerHTML = `
      <ol id="b_results">
        <li class="b_algo">
          <h2><a href="https://www.bing.com/ck/a?u=opaque-tracking-token">Title</a></h2>
          <cite>EHow.com</cite>
        </li>
      </ol>`;
    expect(findSpamResults(document, "https://www.bing.com/search", BING, DOMAINS)).toHaveLength(1);
  });

  it("does not fall back to citation text when the title link already resolves to a real external host", () => {
    document.body.innerHTML = `
      <ol id="b_results">
        <li class="b_algo">
          <h2><a href="https://example.com/real">Title</a></h2>
          <cite>ehow.com</cite>
        </li>
      </ol>`;
    // If the href-based host (example.com, not curated) were overridden by
    // the cite fallback, this would wrongly match too.
    expect(findSpamResults(document, "https://www.bing.com/search", BING, DOMAINS)).toHaveLength(0);
  });
});

describe("findSpamResults (Google rich-card markup with an earlier same-origin anchor)", () => {
  it("picks the anchor wrapping the <h3>, not an earlier google.com thumbnail/favicon link", () => {
    // Live-verified: some Google result cards have an earlier same-origin
    // anchor (a thumbnail/favicon link) before the actual title anchor.
    document.body.innerHTML = `
      <div id="search">
        <div class="g">
          <a href="https://www.google.com/search?q=related"><img alt="favicon"></a>
          <a href="https://ehow.com/real-article"><h3>Title</h3></a>
        </div>
      </div>`;
    expect(findSpamResults(document, "https://www.google.com/search", GOOGLE, DOMAINS)).toHaveLength(1);
  });

  it("falls back to the first anchor for a card with no <h3> at all (a rich/carousel result)", () => {
    document.body.innerHTML = `
      <div id="search">
        <div class="g"><a href="https://ehow.com/no-heading-here">Title text, no h3</a></div>
      </div>`;
    expect(findSpamResults(document, "https://www.google.com/search", GOOGLE, DOMAINS)).toHaveLength(1);
  });
});

describe("hostFromCiteText", () => {
  it("parses a bare host with no scheme (Bing's citation format)", () => {
    expect(hostFromCiteText("RTINGS.com")).toBe("rtings.com");
  });

  it("parses a full breadcrumb-style URL (Google's citation format), stopping at the first breadcrumb separator", () => {
    expect(hostFromCiteText("https://www.pcmag.com › ... › Headphones")).toBe("pcmag.com");
  });

  it("stops at the first slash for a bare URL with a path", () => {
    expect(hostFromCiteText("https://www.example.com/some/path")).toBe("example.com");
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
