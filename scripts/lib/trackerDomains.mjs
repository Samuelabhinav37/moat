// Builds rules/tracker-domains.json: Ghostery TrackerDB's domain -> company
// and purpose, packed small, so the worker can say who a blocked request
// belonged to and what it was for from the request's own domain. That needs
// no declarativeNetRequest feedback (getMatchedRules allows 20 calls per 10
// minutes), so the Trackers count can't fall to zero after heavy browsing.
//
// Shape: { o: [company names], c: [categories], d: { domain: [oIndex, cIndex] } }.
// Built from node_modules at build time; nothing is fetched.

/**
 * @param {{ domains: Record<string, string>, patterns: Record<string, { organization?: string | null, category?: string, name?: string }>, organizations: Record<string, { name?: string }> }} trackerDb
 */
export function buildTrackerDomains(trackerDb) {
  const orgs = [];
  const cats = [];
  const orgIndex = new Map();
  const catIndex = new Map();
  const indexOf = (map, list, value) => {
    if (!map.has(value)) {
      map.set(value, list.length);
      list.push(value);
    }
    return map.get(value);
  };
  /** @type {Record<string, [number, number]>} */
  const d = {};
  for (const domain of Object.keys(trackerDb.domains).sort()) {
    const pattern = trackerDb.patterns[trackerDb.domains[domain]];
    if (!pattern?.category) continue;
    // A pattern without an organization is its own company (TrackerDB lists
    // small trackers that way).
    const company = (pattern.organization && trackerDb.organizations[pattern.organization]?.name) || pattern.name;
    if (!company) continue;
    d[domain.toLowerCase()] = [indexOf(orgIndex, orgs, company), indexOf(catIndex, cats, pattern.category)];
  }
  return { o: orgs, c: cats, d };
}
