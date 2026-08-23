/**
 * All domain suffixes of hostname, from most to least specific, e.g.
 * "a.b.example.com" -> ["a.b.example.com", "b.example.com", "example.com"].
 * The bare TLD ("com") is deliberately excluded -- nothing should ever
 * match rules keyed on it. Shared by the popup-guard's redirect-domain
 * matching and the cosmetic filter's per-domain selector lookup, both of
 * which need "does this rule's domain apply to hostname, or a parent of
 * it" semantics.
 */
export function domainChain(hostname: string): string[] {
  const labels = hostname.split(".");
  const chain: string[] = [];
  for (let i = 0; i < labels.length - 1; i += 1) {
    chain.push(labels.slice(i).join("."));
  }
  return chain;
}
