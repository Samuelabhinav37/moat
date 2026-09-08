// Asks jsDelivr to drop its cached copy of the live/ files after you've
// pushed a change to master. Without this, a branch path can serve stale
// bytes for up to ~12h. Plain unauthenticated HTTPS GETs -- no token needed.
//
//   git push && node scripts/purge-live-cdn.mjs
const FILES = ["manifest.json", "redirect-domains.json", "quick-fixes.json"];
const BASE = "https://purge.jsdelivr.net/gh/Samuelabhinav37/moat@master/live";

let failed = 0;
for (const name of FILES) {
  const url = `${BASE}/${name}`;
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    console.log(`${res.ok ? "purged" : `FAILED ${res.status}`}  ${name}${body.id ? `  (job ${body.id})` : ""}`);
    if (!res.ok) failed++;
  } catch (err) {
    console.log(`FAILED  ${name}  ${err.message}`);
    failed++;
  }
}
process.exit(failed === 0 ? 0 : 1);
