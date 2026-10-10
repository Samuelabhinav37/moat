// Sites page: one row per site, not per address. docs.google.com and
// mail.google.com sit under google.com. Moat carries no public-suffix list,
// so this is a heuristic: the last two labels, or the last three when the
// second-to-last is a common second-level label under a country code
// (bbc.co.uk, example.com.au). A miss only means two rows instead of one.

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "ne", "or", "go", "gob", "nic", "mil"]);

/** The site an address belongs to: "docs.google.com" -> "google.com". */
export function siteOf(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const take = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

export interface SiteGroup<T> {
  site: string;
  count: number;
  members: T[];
}

/** Groups addresses by site, keeping each group's members and the groups
 * themselves in order of most blocks. */
export function groupSites<T extends { hostname: string; count: number }>(rows: readonly T[]): SiteGroup<T>[] {
  const groups = new Map<string, SiteGroup<T>>();
  for (const row of rows) {
    const site = siteOf(row.hostname);
    const group = groups.get(site) ?? { site, count: 0, members: [] };
    group.count += row.count;
    group.members.push(row);
    groups.set(site, group);
  }
  for (const group of groups.values()) group.members.sort((a, b) => b.count - a.count || a.hostname.localeCompare(b.hostname));
  return [...groups.values()].sort((a, b) => b.count - a.count || a.site.localeCompare(b.site));
}

/** What a group is called: its one address when it has just one, or the site. */
export function groupLabel(group: SiteGroup<{ hostname: string }>): string {
  return (group.members.length === 1 ? group.members[0]!.hostname : group.site).replace(/^www\./, "");
}
