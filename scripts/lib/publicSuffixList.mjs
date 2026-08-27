// Real Public Suffix List lookup, shared by scripts/analysis/consolidation-audit.mjs
// and scripts/analysis/consolidation-candidates-reviewed.mjs -- both need
// "what's the real registrable domain for this hostname" and both
// specifically need to avoid a naive last-two-labels split, which both (1)
// treats multi-label ccTLD suffixes like co.uk/com.br/com.au/co.jp as if
// they were themselves registrable domains, and (2) has no way to know that
// github.io/blogspot.com/weebly.com etc. are shared-hosting platforms, not
// single owners. The real PSL lists both kinds of suffix (ICANN section for
// ccTLDs, "private" section for shared-hosting platforms), so a correct
// lookup naturally refuses to group unrelated sites under either as if they
// were siblings. See docs/research/dnr-rule-consolidation-audit.md for the
// full writeup this logic feeds.
import { fetchWithRetry } from "./fetchWithRetry.mjs";

const PSL_URL = "https://publicsuffix.org/list/public_suffix_list.dat";

export async function loadPsl() {
  const response = await fetchWithRetry(PSL_URL);
  const text = await response.text();
  const rules = new Set();
  const exceptions = new Set();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("!")) exceptions.add(line.slice(1));
    else rules.add(line);
  }
  return { rules, exceptions };
}

/** Standard PSL algorithm: longest matching suffix wins, exceptions override
 * at their exact label depth. Returns the suffix's label count. */
function publicSuffixLabelCount(labels, psl) {
  let best = 1; // implicit "*" rule: the last label alone, if nothing else matches
  for (let i = 0; i < labels.length; i++) {
    const candidateLabelCount = labels.length - i;
    const candidate = labels.slice(i).join(".");
    if (psl.exceptions.has(candidate)) return candidateLabelCount - 1;
    if (psl.rules.has(candidate)) {
      best = Math.max(best, candidateLabelCount);
      continue;
    }
    const wildcardCandidate = "*." + labels.slice(i + 1).join(".");
    if (i + 1 < labels.length && psl.rules.has(wildcardCandidate)) {
      best = Math.max(best, candidateLabelCount);
    }
  }
  return best;
}

/** Null when the domain IS its own public suffix (e.g. "co.uk", "github.io"
 * itself) -- not a registrable domain, deliberately excluded from grouping. */
export function registrableDomain(domain, psl) {
  const labels = domain.split(".");
  const suffixLabels = publicSuffixLabelCount(labels, psl);
  if (labels.length <= suffixLabels) return null;
  return labels.slice(labels.length - suffixLabels - 1).join(".");
}
