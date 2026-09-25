// Shared fetch -> parse -> validate -> write shape used by every scripts/vendor-*.mjs
// script (vendor-cname-list.mjs, vendor-consent-rules.mjs): each one differs only in
// its source URL, how it parses the raw response text, and what it considers valid.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fetchWithRetry } from "./fetchWithRetry.mjs";

/**
 * @param {object} opts
 * @param {string} opts.url - source to fetch.
 * @param {string} opts.describe - human name for error messages (e.g. "NextDNS cname-cloaking-blocklist").
 * @param {string} opts.outFile - absolute path to write the parsed result to, as JSON.
 * @param {(text: string) => unknown} opts.parse - turn the raw response text into the shape to validate/write.
 * @param {(parsed: unknown) => void} opts.validate - throw if the parsed data isn't acceptable to ship.
 * @param {string} [opts.snapshotFile] - a committed copy of the last good result. Refreshed on
 *   every good fetch. Used instead when the source can't be reached (network error or an HTTP
 *   error), so an upstream that disappears doesn't break every build. Never used when the
 *   source answers but its content fails to parse or validate: that needs a human to look.
 * @param {number} [opts.retryDelayMs] - passed to fetchWithRetry as its base delay (tests only).
 * @returns the parsed value, so the caller can log a count/summary specific to its own shape.
 */
export async function fetchAndVendor({ url, describe, outFile, parse, validate, snapshotFile, retryDelayMs }) {
  let text;
  try {
    const response = await fetchWithRetry(url, retryDelayMs === undefined ? undefined : { baseDelayMs: retryDelayMs });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${describe}: ${response.status} ${response.statusText}`);
    }
    text = await response.text();
  } catch (err) {
    if (!snapshotFile || !existsSync(snapshotFile)) throw err;
    const reason = err.message.startsWith("Failed to fetch") ? err.message : `Failed to fetch ${describe}: ${err.message}`;
    // "::warning::" shows up as an annotation on the GitHub Actions run, so a
    // source that has gone away is visible without failing the build.
    const prefix = process.env.GITHUB_ACTIONS ? "::warning::" : "Warning: ";
    console.warn(`${prefix}${reason}. Using the last good copy in ${snapshotFile}.`);
    const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8"));
    validate(snapshot);
    write(outFile, snapshot);
    return snapshot;
  }

  let parsed;
  try {
    parsed = parse(text);
  } catch (err) {
    throw new Error(`${describe} did not parse as expected: ${err.message}`);
  }

  validate(parsed);

  write(outFile, parsed);
  if (snapshotFile) write(snapshotFile, parsed);

  return parsed;
}

function write(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}
