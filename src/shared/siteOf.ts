// The site an address belongs to: "docs.google.com" -> "google.com". Moat
// carries no public-suffix list, so this is a heuristic: the last two
// labels, or the last three when the second-to-last is a common
// second-level label under a country code (bbc.co.uk, example.com.au).
// Used by Settings' Sites page and by the pop-up firewall's frame check.

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "ne", "or", "go", "gob", "nic", "mil"]);

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

