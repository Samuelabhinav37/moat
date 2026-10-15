// Sends a problem report to Moat's report service. Shared by the popup's
// report panel and the full report page, so both send the same way.
import { REPORT_ENDPOINT } from "../shared/reportEndpoint";
import type { ProblemReport } from "../shared/problemReport";

/** Resolves to the report's reference ("R-123"). Rejects with "busy" when
 * the service is rate limiting, or another message when sending failed. */
export async function sendReport(report: ProblemReport, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!REPORT_ENDPOINT) throw new Error("no-service");
  const response = await fetchImpl(REPORT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-moat-report": "1" },
    body: JSON.stringify(report),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!response.ok || !body.id) throw new Error(response.status === 429 ? "busy" : body.error ?? String(response.status));
  return body.id;
}
