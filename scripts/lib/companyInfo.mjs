// Builds rules/dnr/company-info.json: a company-name -> { description, url }
// map, for the Settings page's "Trackers" tab (see src/options/trackerView.ts).
// Keyed by the same company-name strings update-filters.mjs already writes
// into rule-companies.json via ruleCompany.mjs's lookupCompany(), so the
// runtime can join a per-tab companyBreakdown straight onto this.
//
// Only companies with a non-empty TrackerDB description survive -- a row with
// nothing to say adds noise, not information. The output is deduped to just
// the companies actually attributed to a shipped rule, not TrackerDB's full
// ~2,600-organization catalog.

/**
 * @param {Iterable<string>} attributedCompanyNames company names that appear in rule-companies.json
 * @param {{ organizations: Record<string, { name?: string, description?: string, website_url?: string }> }} trackerDb
 *   parsed @ghostery/trackerdb dist/trackerdb.json
 * @returns {Record<string, { description: string, url: string | null }>}
 */
export function buildCompanyInfo(attributedCompanyNames, trackerDb) {
  const byName = new Map();
  for (const org of Object.values(trackerDb.organizations)) {
    const name = org?.name;
    if (name && !byName.has(name)) byName.set(name, org);
  }

  /** @type {Record<string, { description: string, url: string | null }>} */
  const out = {};
  for (const name of attributedCompanyNames) {
    const org = byName.get(name);
    const description = firstSentence(org?.description?.trim());
    if (!description) continue;
    const url = org?.website_url?.trim();
    out[name] = { description, url: url || null };
  }
  return out;
}

// TrackerDB descriptions are often two or three formal sentences; the
// Settings "Trackers" tab only needs the first. Falls back to the whole
// string if the first sentence is suspiciously short (an abbreviation like
// "Foo Inc." caught the terminator early).
function firstSentence(text) {
  if (!text) return "";
  const match = text.match(/^.+?[.!?](?=\s|$)/);
  if (match && match[0].length >= 40) return match[0];
  return text;
}
