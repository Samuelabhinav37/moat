// A single flaky network blip (transient DNS hiccup, GitHub/AdGuard CDN 5xx,
// a dropped connection) shouldn't fail the whole filters:update chain -- it
// runs on every CI push, and every script that calls this hits an external
// host with no retry today. Retries only network-level failures and 5xx/429
// responses (signals a transient problem upstream); a 4xx other than 429, or
// any error thrown by the caller's own parsing/validation, is a real bug and
// still fails immediately.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.attempts] - total attempts, including the first (default 3).
 * @param {number} [opts.baseDelayMs] - delay before the 2nd attempt; doubles each retry (default 1000).
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, { attempts = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) return response;
      lastErr = new Error(`${response.status} ${response.statusText}`);
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) throw err;
    }
    const delay = baseDelayMs * 2 ** (attempt - 1);
    console.warn(`Fetch failed (attempt ${attempt}/${attempts}) for ${url}: ${lastErr.message}. Retrying in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastErr;
}
