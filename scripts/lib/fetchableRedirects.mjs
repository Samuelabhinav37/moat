// A rule that answers a request with one of Moat's bundled stand-in files
// (redirect.extensionPath) tells the page Moat's own address if the page
// made that request with fetch() or XMLHttpRequest: response.url and
// xhr.responseURL show the chrome-extension:// or moz-extension:// URL. In
// Chrome that names Moat to any site. In Firefox the address holds a random
// id made at install, the same on every site, so any site could read it and
// recognize the browser again later, cookies cleared or not.
//
// Script, image, frame and media requests don't show the page the final
// address, so those keep their stand-in. For xmlhttprequest (which is what
// DNR calls fetch() too) the request is blocked instead: the page sees a
// network error, the same as for any blocked request.

const FETCH = "xmlhttprequest";

/** Resource types DNR applies a rule to when it lists none: everything but
 * the top-level page. */
function coversFetch(condition) {
  if (condition.resourceTypes) return condition.resourceTypes.includes(FETCH);
  return !(condition.excludedResourceTypes ?? []).includes(FETCH);
}

const isStandIn = (rule) => rule.action?.type === "redirect" && typeof rule.action.redirect?.extensionPath === "string";

/** True when a rule would hand fetch()/XHR a stand-in file. */
export function exposesExtensionAddress(rule) {
  return isStandIn(rule) && coversFetch(rule.condition ?? {});
}

/**
 * `allow`: rules to leave as they are (Moat's measured retry-loop stubs,
 * each limited to the one site it was measured on).
 *
 * Returns `rules` with every stand-in redirect kept off fetch()/XHR: one
 * listing only xmlhttprequest becomes a block; one covering it among other
 * types keeps the others and gets a block twin for xmlhttprequest, with a new
 * id no other rule in the set uses. Pure.
 */
export function splitFetchableRedirects(rules, allow = () => false) {
  const used = new Set(rules.map((r) => r.id));
  // A loop, not Math.max(...ids): rulesets hold tens of thousands of rules.
  let nextId = 1;
  for (const id of used) if (id >= nextId) nextId = id + 1;
  const freshId = () => {
    while (used.has(nextId)) nextId += 1;
    used.add(nextId);
    return nextId;
  };
  const out = [];
  let converted = 0;
  let split = 0;
  for (const rule of rules) {
    if (!exposesExtensionAddress(rule) || allow(rule)) {
      out.push(rule);
      continue;
    }
    const { resourceTypes, excludedResourceTypes, ...rest } = rule.condition;
    const block = { ...rule, action: { type: "block" } };
    if (resourceTypes && resourceTypes.length === 1) {
      out.push(block);
      converted += 1;
      continue;
    }
    const others = resourceTypes
      ? { ...rest, resourceTypes: resourceTypes.filter((t) => t !== FETCH) }
      : { ...rest, excludedResourceTypes: [...(excludedResourceTypes ?? []), FETCH] };
    out.push({ ...rule, condition: others });
    out.push({ ...block, id: freshId(), condition: { ...rest, resourceTypes: [FETCH] } });
    split += 1;
  }
  return { rules: out, converted, split };
}
