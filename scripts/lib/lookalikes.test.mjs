import { describe, expect, it } from "vitest";
import { foldConfusables, lookalikeBrand } from "./lookalikes.mjs";

// Names taken from a real week of newly registered domains.
const brand = (domain) => lookalikeBrand(domain.slice(0, domain.lastIndexOf(".")), domain);

describe("lookalikeBrand", () => {
  it.each([
    ["0nedrive-doc.com", "OneDrive"],
    ["antifraud-paypal.com", "PayPal"],
    ["chase-secure-login.com", "Chase"],
    ["rnicrosoft0nllne.com", "Microsoft"],
    ["telegrarn.top", "Telegram"],
    ["trez0r-suite.site", "Trezor"],
    ["esa-vvhatsapp.cyou", "WhatsApp"],
    ["support-appleld.cloud", "Apple"],
    ["apple-xp.top", "Apple"],
    ["dhl-tracking.live", "DHL"],
    ["pаypal.com", "PayPal"], // Cyrillic а
  ])("%s imitates %s", (domain, expected) => {
    expect(brand(domain)).toBe(expected);
  });

  it.each([
    "paypal.com", // the brand's own
    "revolutionary.com",
    "pineapple-farm.com",
    "purchase-orders.com",
    "moonshotmail.app",
    "smithledgeraccounting.com",
    "havenmonitoring.com", // holds "venmo" inside a word
    "cellphonedrive.com",
    "upstream-news.com", // "ups" not as a word
    "ups-store.com", // a short name needs a phishing word
    "applefarmersmarket.com", // an everyday word with too much around it
  ])("%s is not a lookalike", (domain) => {
    expect(brand(domain)).toBeNull();
  });
});

describe("foldConfusables", () => {
  it("folds look-alike letters and pairs", () => {
    expect(foldConfusables("rnicr0soft")).toMatchObject({ folded: "rnicrosoft", paired: "microsoft", disguised: true });
    expect(foldConfusables("paypal").disguised).toBe(false);
  });
});
