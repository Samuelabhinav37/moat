import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesManifestPath = join(__dirname, "..", "rules", "dnr", "manifest.json");

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
    name: "Silent Adblock",
    description:
      "Blocks ads and trackers, and silently closes popup/redirect tabs, without nag screens.",
    version: "0.1.0",
    icons,
    action: {
      default_popup: "popup.html",
      default_icon: icons,
      default_title: "Silent Adblock",
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    permissions: ["storage", "tabs", "webNavigation", "declarativeNetRequest", "privacy", "alarms"],
    host_permissions: ["<all_urls>"],
    declarative_net_request: {
      rule_resources: loadRuleResources(),
    },
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
