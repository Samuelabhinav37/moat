// Generic hiding the browser applies by itself at document start, from
// stylesheets registered as content-script CSS (background/
// optionalContentScripts.ts). An ad box is then hidden from the first frame
// even when Moat's background worker is asleep and its own per-site
// stylesheet (cosmeticInject.ts) and the in-page scanner's matches land a
// moment later. A page can't see these in document.styleSheets.
//
// A registered stylesheet stays for the page's whole life, so it may only
// hide what the worker would hide on that page too:
// - early-cosmetics.css: generic selectors no site makes an exception for.
// - early-cosmetics-excepted.css: generic selectors whose exceptions are all
//   on plain domains. Registered for every site except those domains (and
//   their subdomains), listed in early-cosmetics-exclude.json.
// Selectors excepted on a wildcard domain ("ebay.*") can't be written as a
// match pattern and stay worker-only.
//
// Only selectors whose last part names an id or class go in: the browser
// files those by that id or class and checks them only against elements that
// have it. One ending in an attribute or "*" is checked against every
// element of every page; measured on a 12,000-element page, the full generic
// set doubled style time (196 -> 404 ms). Those stay worker-only too.

/** Same batching as src/content/cosmeticSelectors.ts's buildStyleText. */
const SELECTORS_PER_RULE = 2000;
const PLAIN_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** The last compound selector, after the last combinator outside brackets
 * and parentheses. */
function lastCompound(selector) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === "\\") i++;
    else if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (depth === 0 && (c === " " || c === ">" || c === "+" || c === "~")) start = i + 1;
  }
  return selector.slice(start).trim();
}

/** True when the browser can file the selector by an id or class. */
export function isIndexedSelector(selector) {
  return /^[a-z]*[#.](?:[\w-]|\\.)/i.test(lastCompound(selector));
}

function styleText(selectors) {
  const rules = [];
  for (let i = 0; i < selectors.length; i += SELECTORS_PER_RULE) {
    rules.push(`${selectors.slice(i, i + SELECTORS_PER_RULE).join(",")}{display:none!important}`);
  }
  return rules.join("\n");
}

/** Every generic selector: the always-on slice and the token-filed ones. */
function allGeneric(meta) {
  return [...new Set([...(meta.genericHigh ?? []), ...Object.values(meta.genericByHash ?? {}).flat()])];
}

/** selector -> the domains that make an exception for it. */
function exceptionDomains(meta) {
  const bySelector = new Map();
  for (const [domain, selectors] of Object.entries(meta.exceptions ?? {})) {
    for (const selector of selectors) {
      if (!bySelector.has(selector)) bySelector.set(selector, new Set());
      bySelector.get(selector).add(domain);
    }
  }
  return bySelector;
}

export function buildEarlyCosmetics(meta) {
  const excepted = exceptionDomains(meta);
  const everywhere = [];
  const exceptedSelectors = [];
  const excludeDomains = new Set();
  for (const selector of allGeneric(meta)) {
    if (!isIndexedSelector(selector)) continue;
    const domains = excepted.get(selector);
    if (!domains) {
      everywhere.push(selector);
    } else if ([...domains].every((d) => PLAIN_DOMAIN.test(d))) {
      exceptedSelectors.push(selector);
      for (const d of domains) excludeDomains.add(d);
    }
  }
  return {
    css: styleText(everywhere),
    exceptedCss: styleText(exceptedSelectors),
    excludeDomains: [...excludeDomains].sort(),
  };
}
