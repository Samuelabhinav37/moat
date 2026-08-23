// Downloads raw (text-format) AdGuard filter lists and builds the cosmetic
// element-hiding index that src/content/cosmeticFilter.ts injects as CSS.
//
// Unlike update-filters.mjs, this needs the network: cosmetic (##) rules
// only exist in the raw filter text, and @adguard/dnr-rulesets only bundles
// the already-compiled network-only DNR JSON, not the source text.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";
import { buildCosmeticIndex } from "./lib/parseCosmeticRules.mjs";
import { bucketForDomain } from "./lib/domainBucket.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "rules", "dnr");

// Only the lists with meaningful cosmetic content -- the pure security/
// network lists (malicious/phishing/scam URL blocklists, URL tracking)
// carry ~0 cosmetic rules and aren't worth fetching here.
const FILTER_IDS = [2, 3, 4, 18, 19, 21, 257];

async function fetchFilterText(id) {
  const url = `https://filters.adtidy.org/extension/chromium-mv3/filters/${id}.txt`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch filter ${id}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const validationDoc = dom.window.document;
function isValidSelector(selector) {
  try {
    validationDoc.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

console.log(`Fetching ${FILTER_IDS.length} filter lists...`);
const texts = await Promise.all(FILTER_IDS.map(fetchFilterText));

const index = buildCosmeticIndex(texts, isValidSelector);

// Our own additions, not sourced from AdGuard: the sidebar/in-feed ad cards
// on YouTube's watch page (verified live -- a "Sponsored" card was showing,
// fully visible, confirming AdGuard's bundled selectors for it either don't
// match YouTube's current markup or aren't present in the lists we fetch).
// These are plain static cards, not the shared-player video ads that need
// the grayscale treatment in content/youtubeAdDimmer.ts -- hiding them
// outright is safe and doesn't touch layout the way hiding the player would.
const OWN_DOMAIN_SELECTORS = {
  "youtube.com": [
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-companion-slot-renderer",
    "ytd-statement-banner-renderer",
    "#player-ads",
  ],
};
for (const [domain, selectors] of Object.entries(OWN_DOMAIN_SELECTORS)) {
  const existing = new Set(index.perDomain[domain] ?? []);
  for (const selector of selectors) existing.add(selector);
  index.perDomain[domain] = [...existing];
}

mkdirSync(outDir, { recursive: true });

// perDomain covers ~50k domains -- fetching all of it on every page load
// (regardless of which site is actually open) is most of what makes the
// cosmetic filter slow to start. Instead of update-filters.mjs's size-based
// chunking (which groups domains by file size, unrelated to which site is
// being visited), bucket each domain by a hash of its name into a fixed
// number of shard files: the content script (src/content/cosmeticFilter.ts)
// then only has to fetch the 1-3 buckets its own domain chain hashes into.
// scripts/lib/domainBucket.mjs's bucketForDomain must produce the exact same
// bucket at runtime -- see src/shared/domainBucket.ts and
// scripts/lib/domainBucket.test.mjs.
const BUCKET_COUNT = 64;
const MAX_CHUNK_BYTES = 4.5 * 1024 * 1024;

const perDomainEntries = Object.entries(index.perDomain);
const buckets = Array.from({ length: BUCKET_COUNT }, () => ({}));
for (const [domain, selectors] of perDomainEntries) {
  buckets[bucketForDomain(domain, BUCKET_COUNT)][domain] = selectors;
}

writeFileSync(
  join(outDir, "cosmetics-meta.json"),
  JSON.stringify({ generic: index.generic, exceptions: index.exceptions })
);

buckets.forEach((bucket, i) => {
  const text = JSON.stringify(bucket);
  if (text.length > MAX_CHUNK_BYTES) {
    throw new Error(
      `cosmetics-bucket-${i}.json is ${text.length} bytes, over the ${MAX_CHUNK_BYTES}-byte lint limit -- ` +
        `raise BUCKET_COUNT in scripts/update-cosmetics.mjs.`
    );
  }
  writeFileSync(join(outDir, `cosmetics-bucket-${i}.json`), text);
});

writeFileSync(
  join(outDir, "cosmetics-manifest.json"),
  JSON.stringify({ meta: "cosmetics-meta.json", bucketCount: BUCKET_COUNT })
);

const perDomainCount = perDomainEntries.reduce((sum, [, s]) => sum + s.length, 0);
const exceptionCount = Object.values(index.exceptions).reduce((sum, s) => sum + s.length, 0);
const largestBucketBytes = Math.max(...buckets.map((b) => JSON.stringify(b).length));
console.log(
  `Wrote ${1 + BUCKET_COUNT} cosmetics file(s): ${index.generic.length} generic selectors, ` +
    `${perDomainCount} domain-scoped selectors across ${perDomainEntries.length} domains ` +
    `(${BUCKET_COUNT} shard buckets, largest ${(largestBucketBytes / 1024).toFixed(1)}KB), ` +
    `${exceptionCount} exceptions`
);
