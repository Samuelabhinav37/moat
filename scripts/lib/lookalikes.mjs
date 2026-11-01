// Picks, from newly registered domains, the ones dressed up as a brand,
// bank or sign-in page (scripts/update-live-lookalikes.mjs). Moat warns on
// those, it doesn't block: a new site that only looks like a brand is
// suspicious, not proven bad.
//
// A domain matches a brand when its name (everything before the public
// suffix, punycode decoded, look-alike letters folded) contains the brand:
//   - distinctive names (paypal, coinbase) on their own, unless buried
//     inside a longer word (havenmonitoring holds "venmo");
//   - names that are also everyday words (apple, chase, outlook) only with
//     a disguise (look-alike letters), a phishing word (login, verify...), or
//     as a whole word with little else in the name (apple-kf, ledger.com.mk);
//   - short names (ups, dhl, irs) only as a whole word between hyphens or
//     dots, and with a phishing word.
// The brand's own domains never match.

/** [brand shown to people, tokens, own registrable domains, kind, words
 * that contain a token but aren't the brand]. kind: "distinct" alone is
 * enough; "word" needs a disguise or phishing word; "short" needs to be a
 * whole word plus a phishing word. */
export const BRANDS = [
  ["PayPal", ["paypal"], ["paypal.com", "paypal.me"], "distinct"],
  ["Apple", ["apple", "icloud", "appleid"], ["apple.com", "icloud.com"], "word", ["appleton", "pineapple", "applesauce"]],
  ["Microsoft", ["microsoft", "office365"], ["microsoft.com", "office.com", "outlook.com", "live.com", "hotmail.com", "onedrive.com", "microsoftonline.com"], "distinct"],
  ["Hotmail", ["hotmail"], ["hotmail.com", "live.com", "microsoft.com"], "word"],
  ["OneDrive", ["onedrive"], ["onedrive.com", "live.com", "microsoft.com"], "word"],
  ["Outlook", ["outlook"], ["outlook.com", "live.com", "microsoft.com"], "word"],
  ["Google", ["google"], ["google.com", "gmail.com"], "word"],
  ["Gmail", ["gmail"], ["google.com", "gmail.com"], "word"],
  ["Amazon", ["amazon"], ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.in", "amazon.ca", "amazon.fr", "amazon.co.jp", "aws.amazon.com"], "word"],
  ["Facebook", ["facebook"], ["facebook.com"], "distinct"],
  ["Instagram", ["instagram"], ["instagram.com"], "distinct"],
  ["WhatsApp", ["whatsapp"], ["whatsapp.com"], "distinct"],
  ["Netflix", ["netflix"], ["netflix.com"], "distinct"],
  ["Chase", ["chase"], ["chase.com"], "word", ["purchase"]],
  ["Wells Fargo", ["wellsfargo"], ["wellsfargo.com"], "distinct"],
  ["Bank of America", ["bankofamerica"], ["bankofamerica.com"], "distinct"],
  ["Citi", ["citibank"], ["citi.com", "citibank.com"], "distinct"],
  ["Capital One", ["capitalone"], ["capitalone.com"], "distinct"],
  ["American Express", ["americanexpress"], ["americanexpress.com"], "distinct"],
  ["HSBC", ["hsbc"], ["hsbc.com", "hsbc.co.uk"], "distinct"],
  ["Barclays", ["barclays"], ["barclays.co.uk", "barclays.com"], "distinct"],
  ["Santander", ["santander"], ["santander.com", "santander.co.uk"], "word"],
  ["Revolut", ["revolut"], ["revolut.com"], "distinct", ["revolution"]],
  ["Venmo", ["venmo"], ["venmo.com"], "distinct"],
  ["Cash App", ["cashapp"], ["cash.app"], "distinct"],
  ["Coinbase", ["coinbase"], ["coinbase.com"], "distinct"],
  ["Binance", ["binance"], ["binance.com"], "distinct"],
  ["Kraken", ["kraken"], ["kraken.com"], "word"],
  ["MetaMask", ["metamask"], ["metamask.io"], "distinct"],
  ["Ledger", ["ledger"], ["ledger.com"], "word", ["accounting", "bookkeep"]],
  ["Trezor", ["trezor"], ["trezor.io"], "distinct"],
  ["Steam", ["steamcommunity", "steampowered"], ["steamcommunity.com", "steampowered.com"], "distinct"],
  ["Roblox", ["roblox"], ["roblox.com"], "distinct"],
  ["Discord", ["discord"], ["discord.com", "discord.gg", "discordapp.com"], "distinct"],
  ["Telegram", ["telegram"], ["telegram.org", "t.me"], "word"],
  ["LinkedIn", ["linkedin"], ["linkedin.com"], "distinct"],
  ["Dropbox", ["dropbox"], ["dropbox.com"], "distinct"],
  ["DocuSign", ["docusign"], ["docusign.com", "docusign.net"], "distinct"],
  ["Adobe", ["adobe"], ["adobe.com"], "word"],
  ["eBay", ["ebay"], ["ebay.com", "ebay.co.uk", "ebay.de"], "word"],
  ["Walmart", ["walmart"], ["walmart.com"], "word"],
  ["Yahoo", ["yahoo"], ["yahoo.com"], "word"],
  ["Spotify", ["spotify"], ["spotify.com"], "distinct"],
  ["GitHub", ["github"], ["github.com", "github.io"], "distinct"],
  ["Okta", ["okta"], ["okta.com"], "word"],
  ["DHL", ["dhl"], ["dhl.com", "dhl.de"], "short"],
  ["FedEx", ["fedex"], ["fedex.com"], "distinct"],
  ["UPS", ["ups"], ["ups.com"], "short"],
  ["USPS", ["usps"], ["usps.com"], "short"],
  ["IRS", ["irs"], ["irs.gov"], "short"],
];

/** Words phishing pages put next to a brand. */
export const PHISHING_WORDS = [
  "login", "signin", "logon", "verify", "verification", "secure", "security", "account", "support",
  "wallet", "update", "billing", "auth", "recovery", "unlock", "confirm", "suspended", "refund",
  "payment", "invoice", "delivery", "parcel", "tracking", "customs", "claim", "reward", "airdrop", "helpdesk",
];

// Look-alike letters: Cyrillic and Greek letters that render like Latin,
// then digit and letter-pair swaps.
const CONFUSABLE_CHARS = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d", "ɡ": "g", "ⅼ": "l",
  "α": "a", "ο": "o", "ρ": "p", "ν": "v", "τ": "t", "ι": "i", "κ": "k",
  "0": "o", "1": "l", "3": "e", "5": "s", "@": "a",
};
const CONFUSABLE_PAIRS = [["rn", "m"], ["vv", "w"], ["cl", "d"]];

/** The name with look-alikes folded, and whether any were. */
export function foldConfusables(name) {
  let folded = "";
  for (const ch of name.normalize("NFKC").toLowerCase()) folded += CONFUSABLE_CHARS[ch] ?? ch;
  let paired = folded;
  for (const [from, to] of CONFUSABLE_PAIRS) paired = paired.split(from).join(to);
  return { folded, paired, disguised: folded !== name.toLowerCase() };
}

const OWN = new Map(BRANDS.flatMap(([brand, , own]) => own.map((domain) => [domain, brand])));

/**
 * @param {string} unicodeName - the domain with its public suffix removed,
 *   already punycode-decoded (e.g. "secure-paypal" for secure-paypal.com).
 * @param {string} registrable - the registrable domain, to skip the brand's own.
 * @returns {string|null} the brand it imitates.
 */
export function lookalikeBrand(unicodeName, registrable) {
  if (OWN.has(registrable)) return null;
  const { folded, paired, disguised: lettersSwapped } = foldConfusables(unicodeName);
  const words = folded.split(/[-.]/);
  const hasPhishingWord = PHISHING_WORDS.some((word) => folded.includes(word));
  for (const [brand, tokens, , kind, notBrand = []] of BRANDS) {
    if (notBrand.some((word) => folded.includes(word))) continue;
    for (const token of tokens) {
      if (kind === "short") {
        if (words.includes(token) && hasPhishingWord) return brand;
        continue;
      }
      // Found only through letter pairs (rn for m), or only after folding
      // look-alike letters: a disguise.
      const at = folded.indexOf(token);
      if (at === -1 && !paired.includes(token)) continue;
      // A whole word: enough for a distinctive name; for an everyday word,
      // only with at most 4 other letters around it.
      if (words.includes(token) && (kind === "distinct" || folded.replace(/[^a-z]/g, "").length - token.length <= 4)) return brand;
      const disguised = at === -1 || (lettersSwapped && !unicodeName.toLowerCase().includes(token));
      // Letters on both sides: the token sits inside some other word.
      const buried = at !== -1 && /[a-z]/.test(folded[at - 1] ?? "") && /[a-z]/.test(folded[at + token.length] ?? "");
      if (disguised || hasPhishingWord || (kind === "distinct" && !buried)) return brand;
    }
  }
  return null;
}
