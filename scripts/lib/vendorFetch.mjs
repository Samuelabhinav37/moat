// Shared fetch -> parse -> validate -> write shape used by every scripts/vendor-*.mjs
// script (vendor-cname-list.mjs, vendor-consent-rules.mjs): each one differs only in
// its source URL, how it parses the raw response text, and what it considers valid.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fetchWithRetry } from "./fetchWithRetry.mjs";

/**
 * @param {object} opts
 * @param {string} opts.url - source to fetch.
 * @param {string} opts.describe - human name for error messages (e.g. "NextDNS cname-cloaking-blocklist").
 * @param {string} opts.outFile - absolute path to write the parsed result to, as JSON.
 * @param {(text: string) => unknown} opts.parse - turn the raw response text into the shape to validate/write.
 * @param {(parsed: unknown) => void} opts.validate - throw if the parsed data isn't acceptable to ship.
 * @returns the parsed value, so the caller can log a count/summary specific to its own shape.
 */
export async function fetchAndVendor({ url, describe, outFile, parse, validate }) {
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${describe}: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();

  let parsed;
  try {
    parsed = parse(text);
  } catch (err) {
    throw new Error(`${describe} did not parse as expected: ${err.message}`);
  }

  validate(parsed);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(parsed));

  return parsed;
}
