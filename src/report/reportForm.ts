// Pure pieces of the report page (report.ts): turning the form into a
// report, and naming the browser. Kept apart so they're testable without the
// page or the extension APIs.
import { REPORT_VERSION, type PauseAnswer, type ProblemReport, type ReportCategory } from "../shared/problemReport";

/** "Chrome 141", "Firefox 144", "Edge 141": the browser and its major version only. */
export function browserLabel(userAgent: string): string {
  const pick = (name: string, re: RegExp) => {
    const match = userAgent.match(re);
    return match ? `${name} ${match[1]}` : null;
  };
  return (
    pick("Firefox", /Firefox\/(\d+)/) ??
    pick("Edge", /Edg\/(\d+)/) ??
    pick("Opera", /OPR\/(\d+)/) ??
    pick("Chrome", /Chrome\/(\d+)/) ??
    "Other"
  );
}

export interface ReportFormState {
  category: ReportCategory;
  hostname: string;
  /** The tab's full address, sent only when includeUrl is set. */
  pageUrl: string | null;
  includeUrl: boolean;
  note: string;
  pausingFixes: PauseAnswer;
}

export interface ReportEnvironment {
  moatVersion: string;
  browser: string;
  level: string;
  lists: string[];
}

export function buildReport(form: ReportFormState, env: ReportEnvironment): ProblemReport {
  const report: ProblemReport = {
    v: REPORT_VERSION,
    category: form.category,
    hostname: form.hostname.trim().toLowerCase().replace(/^www\./, ""),
    note: form.note.trim(),
    moatVersion: env.moatVersion,
    browser: env.browser,
    level: env.level,
    lists: env.lists,
    pausingFixes: form.pausingFixes,
  };
  if (form.includeUrl && form.pageUrl) report.url = form.pageUrl;
  return report;
}

/** A host name typed by hand ("https://www.Example.com/page") reduced to
 * what a report carries ("example.com"). */
export function hostnameFromInput(value: string): string {
  const trimmed = value.trim().toLowerCase();
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, "");
  } catch {
    return trimmed;
  }
}
