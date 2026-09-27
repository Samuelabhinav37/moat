import { describe, expect, it } from "vitest";
import { validateReport } from "../shared/problemReport";
import { browserLabel, buildReport, hostnameFromInput, type ReportFormState } from "./reportForm";

const env = { moatVersion: "0.11.163", browser: "Chrome 141", level: "standard", lists: ["Ads filter"] };
const form: ReportFormState = {
  category: "ads",
  hostname: "www.News.Example.com",
  pageUrl: "https://www.news.example.com/story?id=4&session=abc",
  includeUrl: false,
  note: "  banner at the top  ",
  pausingFixes: "untried",
};

describe("browserLabel", () => {
  it("names the browser and major version only", () => {
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36")).toBe("Chrome 141");
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0")).toBe("Firefox 144");
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57")).toBe("Edge 141");
    expect(browserLabel("curl/8.0")).toBe("Other");
  });
});

describe("buildReport", () => {
  it("sends the site name only unless the full address is ticked", () => {
    const report = buildReport(form, env);
    expect(report.hostname).toBe("news.example.com");
    expect(report.url).toBeUndefined();
    expect(report.note).toBe("banner at the top");
    expect(validateReport(report).ok).toBe(true);
  });

  it("accepts the full address of a www site, whose name drops the www", () => {
    const report = buildReport({ ...form, includeUrl: true }, env);
    expect(report.hostname).toBe("news.example.com");
    expect(report.url).toBe(form.pageUrl);
    expect(validateReport(report).ok).toBe(true);
  });

  it("adds the full address when ticked", () => {
    const report = buildReport({ ...form, hostname: "www.news.example.com", includeUrl: true, pageUrl: "https://news.example.com/story?id=4" }, env);
    expect(report.url).toBe("https://news.example.com/story?id=4");
    expect(validateReport(report).ok).toBe(true);
  });
});

describe("hostnameFromInput", () => {
  it("reduces a typed address to the site name", () => {
    expect(hostnameFromInput(" https://www.Example.com/page?x=1 ")).toBe("example.com");
    expect(hostnameFromInput("shop.example.co.uk")).toBe("shop.example.co.uk");
  });
});
