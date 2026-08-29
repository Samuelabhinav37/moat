// Pure join behind the Settings "Trackers" tab: takes a per-tab company
// breakdown (company name -> blocked count, from the background) and the
// build-time company-info.json (company name -> { description, url }), and
// produces the rows the page renders. No DOM, no fetch -- directly testable.

export interface CompanyInfo {
  description: string;
  url: string | null;
}

export interface TrackerRow {
  company: string;
  count: number;
  /** "" when TrackerDB has no description for this company. */
  description: string;
  url: string | null;
}

export function joinCompanyBreakdown(
  breakdown: Record<string, number>,
  info: Record<string, CompanyInfo>
): TrackerRow[] {
  return Object.entries(breakdown)
    .map(([company, count]) => ({
      company,
      count,
      description: info[company]?.description ?? "",
      url: info[company]?.url ?? null,
    }))
    .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
}
