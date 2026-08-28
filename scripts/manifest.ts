import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesManifestPath = join(__dirname, "..", "rules", "dnr", "manifest.json");
const packageJsonPath = join(__dirname, "..", "package.json");

// Read from package.json rather than hand-copying the version here -- this
// drifted out of sync with package.json for a full release cycle before
// (stayed "0.9.0" through all of 0.9.1) because nothing enforced the two
// staying equal.
const { version: packageVersion } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };

interface RulesetEntry {
  id: string;
  name: string;
  enabled: boolean;
  file: string;
}

function loadRuleResources() {
  const entries = JSON.parse(readFileSync(rulesManifestPath, "utf8")) as RulesetEntry[];
  return entries.map((entry) => ({
    id: entry.id,
    enabled: entry.enabled,
    path: `rules/${entry.file}`,
  }));
}

const icons = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png",
};

function baseManifest() {
  return {
    manifest_version: 3,
    default_locale: "en",
    name: "__MSG_extName__",
    short_name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    homepage_url: "https://github.com/Samuelabhinav37/moat",
    version: packageVersion,
    icons,
    action: {
      default_popup: "popup.html",
      default_icon: icons,
      default_title: "Moat",
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    commands: {
      "toggle-protection": {
        suggested_key: { default: "Ctrl+Shift+M", mac: "Command+Shift+M" },
        description: "Toggle Moat protection on/off",
      },
    },
    permissions: [
      "storage",
      "tabs",
      "webNavigation",
      "declarativeNetRequest",
      "declarativeNetRequestFeedback",
      "privacy",
      "alarms",
      "scripting",
    ],
    host_permissions: ["<all_urls>"],
    storage: {
      managed_schema: "managed_schema.json",
    },
    declarative_net_request: {
      rule_resources: loadRuleResources(),
    },
    // $redirect rules in the bundled filter lists point at these no-op
    // resources (nooptext.js, 1x1-transparent.gif, etc., vendored from
    // @adguard/scriptlets by scripts/update-filters.mjs) via a matching
    // extensionPath -- without this, Chrome/Firefox refuse to serve them to
    // the page and those rules fail closed.
    web_accessible_resources: [
      {
        resources: ["web-accessible-resources/redirects/*"],
        matches: ["<all_urls>"],
      },
      {
        // Only reachable at all when an org's Athena-pushed policy names a
        // blocked domain (see athenaPolicyRules.ts) -- declarativeNetRequest
        // redirects require their extensionPath target to be listed here
        // even for a main_frame navigation, or Chrome blocks the redirect
        // outright.
        resources: ["warning.html"],
        matches: ["<all_urls>"],
      },
    ],
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["main-world-guard.js", "fingerprint-guard.js"],
        run_at: "document_start",
        all_frames: true,
        world: "MAIN" as const,
      },
      {
        matches: ["<all_urls>"],
        js: ["bridge.js"],
        run_at: "document_start",
        all_frames: true,
      },
      {
        // Top frame only: cosmetic rules target the containers a blocked
        // ad leaves behind in the page that hosts it, not the (usually
        // blocked-before-it-loads) ad iframe's own cross-origin content.
        matches: ["<all_urls>"],
        js: ["cosmetic-filter.js"],
        run_at: "document_start",
      },
      {
        // Top frame only, same reasoning as cosmetic-filter.js. Inactive
        // until it receives a "start-picker" message -- document_idle is
        // fine since there's no timing pressure.
        matches: ["<all_urls>"],
        js: ["element-picker.js"],
        run_at: "document_idle",
      },
      {
        // Scoped to YouTube only -- see content/youtubeAdDimmer.ts. No-ops
        // immediately unless "Gray out unblockable video ads" is on.
        matches: ["*://www.youtube.com/*", "*://m.youtube.com/*"],
        js: ["youtube-ad-dimmer.js"],
        run_at: "document_idle",
      },
      {
        // Scoped to Instagram + LinkedIn + YouTube -- see
        // content/feedAdScanner.ts. No-ops immediately unless "Aggressively
        // remove sponsored posts" is on (off by default).
        matches: [
          "*://www.instagram.com/*",
          "*://www.linkedin.com/*",
          "*://www.youtube.com/*",
          "*://m.youtube.com/*",
        ],
        js: ["feed-ad-scanner.js"],
        run_at: "document_idle",
      },
      {
        // Top frame only, same reasoning as cosmetic-filter.js. No-ops
        // immediately unless "Auto-reject cookie banners" is on (off by
        // default) -- see content/consentRejector.ts.
        matches: ["<all_urls>"],
        js: ["consent-rejector.js"],
        run_at: "document_idle",
      },
      {
        // Top frame only. No-ops immediately unless "Check passwords
        // against known breaches" is on (off by default) -- see
        // content/leakedPasswordCheck.ts.
        matches: ["<all_urls>"],
        js: ["leaked-password-check.js"],
        run_at: "document_idle",
      },
    ],
  };
}

export function buildManifest(target: "chrome" | "firefox") {
  const manifest = baseManifest();

  if (target === "chrome") {
    return {
      ...manifest,
      minimum_chrome_version: "111",
      background: {
        service_worker: "background.js",
      },
    };
  }

  return {
    ...manifest,
    // dns/webRequest/webRequestBlocking are Firefox-only additions, for
    // background/cnameUncloak.ts's real CNAME uncloaking -- Chrome has no
    // DNS-resolution API for extensions at all, and MV3 there disallows
    // blocking webRequest listeners entirely (Firefox continues supporting
    // both; see the README's CNAME section).
    permissions: [...manifest.permissions, "dns", "webRequest", "webRequestBlocking"],
    background: {
      scripts: ["background.js"],
    },
    browser_specific_settings: {
      gecko: {
        id: "{9c2a9e7e-9d1a-4b7e-9a3a-7a2f6e6f5d3b}",
        strict_min_version: "140.0",
        // We don't collect anything -- all state stays in browser.storage.local.
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
  };
}
