// Sites page: one row per site, not per address. docs.google.com and
// mail.google.com sit under google.com (siteOf, shared/siteOf.ts). A miss
// only means two rows instead of one.
import { siteOf } from "../shared/siteOf";

export { siteOf };

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
