// AdGuard's lists append Permissions-Policy headers to every page to switch
// off ad-tech browser APIs. Most of those are fine to keep (ad auctions,
// interest groups, Topics). These are not, so they're removed here:
//
// - private-state-token-redemption / -issuance: anti-fraud tokens that let a
//   browser already proven human skip repeat bot checks. Permissions-Policy
//   is inherited by iframes, so the header also switched them off inside
//   Cloudflare's challenge frame (measured: allowsFeature() false in the
//   Turnstile iframe with Moat, true without).
// - identity-credentials-get: FedCM, the browser API behind "Sign in with
//   Google" prompts on sites like LinkedIn and Glassdoor.
export const SITE_BREAKING_POLICY_FEATURES = [
  "private-state-token-redemption",
  "private-state-token-issuance",
  "identity-credentials-get",
];

function isBreakingEntry(entry) {
  if (String(entry?.header).toLowerCase() !== "permissions-policy") return false;
  const value = String(entry.value ?? "");
  return SITE_BREAKING_POLICY_FEATURES.some((feature) => value.includes(`${feature}=`));
}

/** Rules with the breaking header entries removed; a rule left with no
 * header edits at all is dropped. Returns the kept rules and how many rules
 * were changed or dropped. */
export function dropSiteBreakingHeaderRules(rules) {
  let changed = 0;
  const kept = [];
  for (const rule of rules) {
    if (rule.action?.type !== "modifyHeaders") {
      kept.push(rule);
      continue;
    }
    const response = rule.action.responseHeaders ?? [];
    const filtered = response.filter((entry) => !isBreakingEntry(entry));
    if (filtered.length === response.length) {
      kept.push(rule);
      continue;
    }
    changed += 1;
    const requestHeaders = rule.action.requestHeaders ?? [];
    if (filtered.length === 0 && requestHeaders.length === 0) continue;
    const action = { ...rule.action };
    if (filtered.length > 0) action.responseHeaders = filtered;
    else delete action.responseHeaders;
    kept.push({ ...rule, action });
  }
  return { kept, changed };
}
