// Moat's own rules, not from AdGuard: pop-under ad networks that dodge
// blocking by moving to fresh random domains.
//
// Adcash, measured on streamsgate.co (an xstream.st player frame), 10 Oct
// 2026: its loader (adexchangerapid.com/script/suurl5.php) is blocked by the
// bundled lists, so it falls back to a throwaway domain
// (bzynecajutcjj.website, dfnahgnmooktg.online) and asks there for the
// pop-under. Those requests hide the usual fields (cbiframe=, chmob=,
// cbHeight=...) base64-encoded under one random 24-character parameter, in
// a shuffled order, so neither the domain nor a plain field match catches
// them. Every one carries cbiframe=, and base64 spells "cbiframe=" one of
// three ways depending on where it lands in the string. The path is a short
// random lowercase id.
//
// The pop-under it served there was the "Ad Blocker Premium" scam lander
// (adblockerpremium.online, account 7176486).
import { Buffer } from "node:buffer";

/** The three ways base64 can spell `text`, one per byte alignment, cut to
 * the characters that depend only on `text` itself. */
export function base64Forms(text) {
  const bytes = Buffer.from(text, "latin1");
  const forms = [];
  for (let pad = 0; pad < 3; pad++) {
    const encoded = Buffer.concat([Buffer.alloc(pad, 0x78), bytes, Buffer.from("xxx")]).toString("base64");
    const start = Math.ceil((pad * 4) / 3);
    const end = Math.floor(((pad + bytes.length) * 4) / 3);
    forms.push(encoded.slice(start, end));
  }
  return forms;
}

export const ADCASH_FIELD = "cbiframe=";

/** One host, a one-segment random path, a single random parameter whose
 * base64 value holds cbiframe=. No counted repeats like {24}: Chrome's
 * regex engine gives each rule 2 KB, and those blow it
 * ("memoryLimitExceeded"), which drops the rule without an error. The
 * base64 field is what makes it specific. */
export const ADCASH_FALLBACK_REGEX = `^https?://[^/?#]+/[0-9a-z]+\\?[A-Za-z0-9]+=[A-Za-z0-9+/%=]*(${base64Forms(ADCASH_FIELD).join("|")})`;

export function buildPopunderNetworkRules() {
  return [
    {
      id: 1,
      priority: 1,
      action: { type: "block" },
      condition: {
        regexFilter: ADCASH_FALLBACK_REGEX,
        // Base64 is case-sensitive; matching it case-insensitively would
        // only widen the net for nothing.
        isUrlFilterCaseSensitive: true,
        domainType: "thirdParty",
        resourceTypes: ["xmlhttprequest", "script", "ping", "other"],
      },
    },
  ];
}
