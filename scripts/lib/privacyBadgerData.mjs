// Parsing and checks for Privacy Badger's data (scripts/vendor-privacy-badger.mjs).
// Pure, so it's testable without a network.

const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

// Privacy Badger's seed.json had 3,098 block and 840 cookieblock domains, and
// multiDomainFirstParties.js about 400 groups, when this was written. A
// collapse means the files changed shape, not that the trackers went away.
export const MIN_BLOCK = 1500;
export const MIN_COOKIEBLOCK = 400;
export const MIN_ENTITIES = 200;

/** seed.json's action_map -> sorted block and cookieblock domain lists. */
export function parseSeedActions(seed) {
  const map = seed?.action_map;
  if (!map || typeof map !== "object") throw new Error("seed.json has no action_map");
  const block = [];
  const cookieblock = [];
  for (const [domain, entry] of Object.entries(map)) {
    if (entry?.heuristicAction === "block") block.push(domain);
    else if (entry?.heuristicAction === "cookieblock") cookieblock.push(domain);
  }
  return { block: block.sort(), cookieblock: cookieblock.sort() };
}

/** The array literal in multiDomainFirstParties.js -> groups of domains.
 * Read as data, never run: only the `[...]` after the variable is kept,
 * comments and trailing commas removed, then JSON.parse. */
export function parseEntityGroups(source) {
  const start = source.indexOf("multiDomainFirstPartiesArray = [");
  if (start === -1) throw new Error("multiDomainFirstPartiesArray not found");
  const open = source.indexOf("[", start);
  const close = source.indexOf("\n];", open);
  if (close === -1) throw new Error("end of multiDomainFirstPartiesArray not found");
  const literal = source
    .slice(open, close + 2)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*\])/g, "$1");
  const groups = JSON.parse(literal);
  if (!Array.isArray(groups)) throw new Error("multiDomainFirstPartiesArray isn't an array");
  return groups.map((group) => [...new Set(group.map((d) => String(d).trim().toLowerCase()))].sort());
}

/** Throws unless the data is safe to ship. */
export function validatePrivacyBadgerData(data) {
  const { block, cookieblock, entities } = data ?? {};
  if (!Array.isArray(block) || block.length < MIN_BLOCK) {
    throw new Error(`Privacy Badger data has only ${block?.length ?? 0} tracker domains -- refusing a suspiciously small list.`);
  }
  if (!Array.isArray(cookieblock) || cookieblock.length < MIN_COOKIEBLOCK) {
    throw new Error(`Privacy Badger data has only ${cookieblock?.length ?? 0} cookie-blocked domains.`);
  }
  if (!Array.isArray(entities) || entities.length < MIN_ENTITIES) {
    throw new Error(`Privacy Badger data has only ${entities?.length ?? 0} company site groups.`);
  }
  const bad = [...block, ...cookieblock, ...entities.flat()].filter((d) => !HOSTNAME.test(d));
  if (bad.length > 0) throw new Error(`Privacy Badger data has entries that aren't plain hostnames: ${bad.slice(0, 5).join(", ")}`);
}

/** domain -> the sites of the company that owns it (its own registrable
 * domain included), for every domain in a group. */
export function entityLookup(entities) {
  const lookup = new Map();
  for (const group of entities) for (const domain of group) lookup.set(domain, group);
  return lookup;
}
