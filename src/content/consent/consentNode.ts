// Cheap pre-check consentRejector.ts runs on each batch of added nodes, so a
// full detection pass only runs right away when a banner may have arrived.
// "privacy" is left out on purpose: nearly every page footer has a Privacy
// link, and a footer re-render would trigger a pass each time.
const CONSENT_TEXT_RE = /cookie|consent|gdpr/i;

/** An added node worth an immediate pass: an iframe (many consent
 * platforms render in one) or an element whose id, class or text mentions
 * cookies, consent or GDPR. */
export function looksLikeConsentNode(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (node.tagName === "IFRAME") return true;
  return (
    CONSENT_TEXT_RE.test(node.id) ||
    CONSENT_TEXT_RE.test(node.getAttribute("class") ?? "") ||
    CONSENT_TEXT_RE.test(node.textContent ?? "")
  );
}
