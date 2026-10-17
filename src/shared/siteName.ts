// What people call a site: "Spotify" for open.spotify.com, "Fandom" for
// jack-reacher.fandom.com. Lists show this name; the full address stays in
// the row's tooltip and detail view. Built from siteOf() (the last two
// labels, or three under a country code), so it is a heuristic: a miss
// shows a plain capitalized word, never a wrong site.
import { siteOf } from "./siteOf";

// Hosts where each subdomain is someone's own site (alice.github.io).
const USER_SITE_HOSTS = new Set([
  "github.io", "gitlab.io", "blogspot.com", "wordpress.com", "tumblr.com", "substack.com", "medium.com",
  "vercel.app", "netlify.app", "pages.dev", "workers.dev", "herokuapp.com", "web.app", "firebaseapp.com",
  "wixsite.com", "weebly.com", "squarespace.com", "neocities.org", "carrd.co", "notion.site",
]);

// Names whose casing a capitalized word gets wrong, by site.
const NAMES: Record<string, string> = {
  "youtube.com": "YouTube", "linkedin.com": "LinkedIn", "github.com": "GitHub", "gitlab.com": "GitLab",
  "paypal.com": "PayPal", "tiktok.com": "TikTok", "whatsapp.com": "WhatsApp", "openai.com": "OpenAI",
  "chatgpt.com": "ChatGPT", "duckduckgo.com": "DuckDuckGo", "stackoverflow.com": "Stack Overflow",
  "nytimes.com": "The New York Times", "washingtonpost.com": "The Washington Post", "wsj.com": "The Wall Street Journal",
  "bbc.co.uk": "BBC", "bbc.com": "BBC", "cnn.com": "CNN", "espn.com": "ESPN", "imdb.com": "IMDb",
  "ebay.com": "eBay", "iheart.com": "iHeart", "icloud.com": "iCloud", "weather.com": "The Weather Channel",
  "manutd.com": "Man Utd", "theguardian.com": "The Guardian", "x.com": "X", "twitter.com": "X",
  "soundcloud.com": "SoundCloud", "deviantart.com": "DeviantArt", "salesforce.com": "Salesforce",
  "abercrombie.com": "Abercrombie & Fitch", "hbomax.com": "HBO Max", "mlb.com": "MLB", "nba.com": "NBA",
  "nfl.com": "NFL", "aliexpress.com": "AliExpress", "booking.com": "Booking.com", "wikipedia.org": "Wikipedia",
  "wikimedia.org": "Wikimedia", "stackexchange.com": "Stack Exchange", "msn.com": "MSN", "aol.com": "AOL",
  "cnet.com": "CNET", "zdnet.com": "ZDNET", "nbcnews.com": "NBC News", "foxnews.com": "Fox News",
  "usatoday.com": "USA Today", "buzzfeed.com": "BuzzFeed", "huffpost.com": "HuffPost", "doubleclick.net": "DoubleClick",
};

function capitalize(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word;
}

/** The name to show for an address. Addresses (IPs) and single labels
 * (localhost) come back as they are. */
export function siteName(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return host;
  const site = siteOf(host);
  if (USER_SITE_HOSTS.has(site) && host !== site) {
    const own = host.slice(0, -(site.length + 1)).split(".").pop()!;
    return capitalize(own);
  }
  const known = NAMES[site];
  if (known) return known;
  return capitalize(site.split(".")[0]!);
}
