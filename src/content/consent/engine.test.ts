// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { runConsentRejection } from "./engine";
import type { CmpConfig, RuleSet } from "./types";

beforeEach(() => {
  document.body.innerHTML = "";
});

// The actual Cookiebot rule as vendored from Consent-O-Matic's Rules.json
// (https://github.com/cavi-au/Consent-O-Matic, MIT-licensed), frozen here
// rather than read from rules/dnr/consent-rules.json so this test doesn't
// depend on npm run filters:update having run and isn't silently broken by
// an upstream rule change -- re-paste from the live source if Cookiebot's
// own banner markup or this rule changes enough to need it.
const COOKIEBOT_CONFIG = JSON.parse(`{
  "detectors": [
    {
      "presentMatcher": [{ "type": "css", "target": { "selector": "#CybotCookiebotDialogBodyButtonAccept, #CybotCookiebotDialogBody, #CybotCookiebotDialogBodyLevelButtonPreferences, #cb-cookieoverlay, #CybotCookiebotDialog" } }],
      "showingMatcher": [{ "type": "css", "target": { "selector": "#CybotCookiebotDialogBodyButtonAccept, #CybotCookiebotDialogBody, #CybotCookiebotDialogBodyLevelButtonPreferences, #cb-cookieoverlay, #CybotCookiebotDialog, #cookiebanner", "displayFilter": true } }]
    }
  ],
  "methods": [
    {
      "action": { "type": "list", "actions": [
        { "type": "click", "target": { "selector": "#CybotCookiebotDialogBodyButtonDetails, #CybotCookiebotDialogBodyLevelButtonCustomize", "displayFilter": true } },
        { "type": "click", "target": { "selector": ".cb-button", "textFilter": ["Manage cookies"], "displayFilter": true } },
        { "type": "click", "target": { "selector": ".js-cookie-settings", "displayFilter": true } },
        { "type": "click", "target": { "selector": "[data-toggle='collapse']", "displayFilter": true } }
      ]},
      "name": "OPEN_OPTIONS"
    },
    {
      "action": { "type": "list", "actions": [
        { "type": "consent", "consents": [
          { "matcher": { "type": "checkbox", "target": { "selector": "#CybotCookiebotDialogBodyLevelButtonPreferences, [name='preferences']" } }, "toggleAction": { "type": "click", "target": { "selector": "#CybotCookiebotDialogBodyLevelButtonPreferences, [name='preferences']" } }, "type": "A" },
          { "matcher": { "type": "checkbox", "target": { "selector": "#CybotCookiebotDialogBodyLevelButtonStatistics,[name='statistics']" } }, "toggleAction": { "type": "click", "target": { "selector": "#CybotCookiebotDialogBodyLevelButtonStatistics, [name='statistics']" } }, "type": "B" },
          { "matcher": { "type": "checkbox", "target": { "selector": "#CybotCookiebotDialogBodyLevelButtonMarketing,[name='marketing']" } }, "toggleAction": { "type": "click", "target": { "selector": "#CybotCookiebotDialogBodyLevelButtonMarketing, [name='marketing']" } }, "type": "F" }
        ]},
        { "type": "foreach", "target": { "childFilter": { "target": { "selector": ":scope > input[id*=CybotCookiebotDialogBodyLevelButtonIABPurposeLegitimateInterest]" } }, "selector": "div.CybotCookiebotDialogBodyLevelButtonWrapper" }, "action": { "type": "consent", "consents": [{ "matcher": { "type": "checkbox", "target": { "selector": "input[id*=CybotCookiebotDialogBodyLevelButtonIABPurposeLegitimateInterest]" } }, "toggleAction": { "type": "click", "target": { "selector": "input[id*=CybotCookiebotDialogBodyLevelButtonIABPurposeLegitimateInterest]" } }, "type": "X" }] } },
        { "type": "foreach", "target": { "childFilter": { "target": { "selector": ":scope > input[id*=CybotCookiebotDialogBodyLevelButtonIABVendorLegitimateInterest]" } }, "selector": "div.CybotCookiebotDialogBodyLevelButtonWrapper" }, "action": { "type": "consent", "consents": [{ "matcher": { "type": "checkbox", "target": { "selector": "input[id*=CybotCookiebotDialogBodyLevelButtonIABVendorLegitimateInterest]" } }, "toggleAction": { "type": "click", "target": { "selector": "input[id*=CybotCookiebotDialogBodyLevelButtonIABVendorLegitimateInterest]" } }, "type": "X" }] } }
      ]},
      "name": "DO_CONSENT"
    },
    {
      "action": { "type": "list", "actions": [
        { "type": "ifcss", "target": { "selector": "#CybotCookiebotDialogBodyUnderlay" }, "trueAction": { "type": "wait", "waitTime": 1 } },
        { "type": "ifcss", "target": { "selector": ".dtcookie__accept", "textFilter": ["Select All and Continue"] }, "trueAction": { "type": "click", "target": { "selector": ".h-dtcookie-decline", "displayFilter": true } }, "falseAction": { "type": "click", "target": { "selector": ".h-dtcookie-accept", "displayFilter": true } } },
        { "type": "click", "target": { "selector": "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection", "displayFilter": true } },
        { "type": "click", "target": { "selector": ".cb-button", "textFilter": ["Save preferences"], "displayFilter": true } },
        { "type": "click", "target": { "selector": ".cb-button", "textFilter": ["Done"], "displayFilter": true } },
        { "type": "ifcss", "target": { "selector": "#CybotCookiebotDialogBodyLevelButtonAccept", "displayFilter": true },
          "trueAction": { "type": "click", "target": { "selector": "#CybotCookiebotDialogBodyLevelButtonAccept" } },
          "falseAction": { "type": "ifcss", "target": { "selector": "#CybotCookiebotDialogBodyButtonAcceptSelected", "displayFilter": true },
            "trueAction": { "type": "click", "target": { "selector": "#CybotCookiebotDialogBodyButtonAcceptSelected" } },
            "falseAction": { "type": "click", "target": { "selector": "#CybotCookiebotDialogBodyButtonAccept" } }
          }
        },
        { "type": "ifcss", "target": { "selector": ".js-cookie-settings-close" }, "trueAction": { "type": "list", "actions": [
          { "type": "click", "target": { "selector": ".js-cookie-settings-close" } },
          { "type": "close" },
          { "type": "waitcss", "target": { "selector": ".JegFindesIkke" }, "retries": 1, "waitTime": 1 }
        ]}},
        { "type": "click", "target": { "selector": "#CybotCookiebotDialogBodyButtonDecline", "displayFilter": true } },
        { "type": "click", "target": { "selector": ".cookie-btn", "textFilter": ["Tillad valgte"], "displayFilter": true } },
        { "type": "click", "target": { "childFilter": { "target": { "selector": "strong", "textFilter": ["Save cookie settings"] } }, "selector": ".cb-button", "displayFilter": true } },
        { "type": "click", "target": { "selector": "[onclick='handleCustomConsent();']", "displayFilter": true } },
        { "type": "click", "target": { "selector": ".submitChosen" } }
      ]},
      "name": "SAVE_CONSENT"
    },
    {
      "action": { "type": "list", "actions": [
        { "type": "hide", "target": { "selector": "#CybotCookiebotDialogBodyUnderlay" } },
        { "type": "hide", "target": { "selector": "#CybotCookiebotDialog" } },
        { "type": "hide", "target": { "selector": "#cb-cookieoverlay" } },
        { "type": "hide", "target": { "selector": "#cookiebanner" } }
      ]},
      "name": "HIDE_CMP"
    },
    { "name": "UTILITY" }
  ]
}`) as CmpConfig;

function markVisible(selector: string): void {
  document.querySelectorAll(selector).forEach((el) => Object.defineProperty(el, "offsetHeight", { value: 40 }));
}

describe("runConsentRejection against the real Cookiebot rule (\"classic\" banner mode, no levels UI)", () => {
  it("detects, hides the dialog, and clicks Decline -- never Accept", async () => {
    document.body.innerHTML = `
      <div id="CybotCookiebotDialog">
        <div id="CybotCookiebotDialogBody">
          <button id="CybotCookiebotDialogBodyButtonDecline">Decline</button>
        </div>
      </div>
    `;
    markVisible("#CybotCookiebotDialog, #CybotCookiebotDialogBody, #CybotCookiebotDialogBodyButtonDecline");

    const declineClicked = countClicksOn("#CybotCookiebotDialogBodyButtonDecline");

    const ruleSet: RuleSet = { cookiebot: COOKIEBOT_CONFIG };
    const result = await runConsentRejection(ruleSet);

    expect(result).toEqual({ handled: true, cmpName: "cookiebot" });
    expect(declineClicked()).toBe(1);

    const dialog = document.getElementById("CybotCookiebotDialog") as HTMLElement;
    expect(dialog.style.display).toBe("none");
  });

  it("does not report handled when the banner isn't present at all", async () => {
    document.body.innerHTML = "<div>ordinary page content</div>";
    const result = await runConsentRejection({ cookiebot: COOKIEBOT_CONFIG });
    expect(result).toEqual({ handled: false });
  });

  it("does not click Decline when the dialog is present but not currently showing", async () => {
    document.body.innerHTML = `
      <div id="CybotCookiebotDialog">
        <div id="CybotCookiebotDialogBody">
          <button id="CybotCookiebotDialogBodyButtonDecline">Decline</button>
        </div>
      </div>
    `;
    // Deliberately not calling markVisible: offsetHeight stays 0 for all
    // elements under jsdom by default, so the showingMatcher's
    // displayFilter:true never matches -- present, but not showing.
    const declineClicked = countClicksOn("#CybotCookiebotDialogBodyButtonDecline");
    const result = await runConsentRejection({ cookiebot: COOKIEBOT_CONFIG });
    expect(result).toEqual({ handled: false });
    expect(declineClicked()).toBe(0);
  });
});

// Small local helper (not vitest's own API) to keep the tests above terse:
// attaches a click counter and returns a getter for it.
function countClicksOn(selector: string): () => number {
  let count = 0;
  document.querySelector(selector)?.addEventListener("click", () => {
    count += 1;
  });
  return () => count;
}

// The actual OneTrust rule as vendored -- OneTrust is the single
// highest-market-share CMP, and its rule exercises a structurally
// different pattern than Cookiebot's: parent-scoped category panels found
// by heading text (both the bare {selector, textFilter} and
// {childFilter, selector} forms), toggled via a checkbox matcher + a
// "label" click as the toggleAction, not Cookiebot's direct-id checkboxes.
const ONETRUST_CONFIG = JSON.parse(`{
  "detectors": [
    { "presentMatcher": { "type": "css", "target": { "selector": "#onetrust-banner-sdk", "displayFilter": true } },
      "showingMatcher": { "type": "css", "target": { "selector": "#onetrust-banner-sdk", "displayFilter": true } } }
  ],
  "methods": [
    { "action": { "type": "click", "target": { "selector": "#onetrust-pc-btn-handler, .ot-sdk-show-settings" } }, "name": "OPEN_OPTIONS" },
    { "action": { "type": "list", "actions": [
      { "type": "click", "target": { "selector": ".category-menu-switch-handler" }, "parent": { "selector": ".category-item", "textFilter": ["Performance Cookies"] } },
      { "type": "consent", "consents": [
        { "matcher": { "type": "checkbox", "target": { "selector": "input.category-switch-handler" }, "parent": { "selector": ".category-item", "textFilter": ["Performance Cookies"] } },
          "toggleAction": { "type": "click", "target": { "selector": "label" }, "parent": { "selector": ".category-item", "textFilter": ["Performance Cookies"] } },
          "type": "B" }
      ]}
    ]}, "name": "DO_CONSENT" },
    { "action": { "type": "click", "target": { "selector": ".save-preference-btn-handler" } }, "name": "SAVE_CONSENT" },
    { "action": { "type": "list", "actions": [{ "type": "hide", "target": { "selector": "#onetrust-consent-sdk" } }] }, "name": "HIDE_CMP" }
  ]
}`) as CmpConfig;

describe("runConsentRejection against the real OneTrust rule (parent-scoped category panel)", () => {
  it("unchecks a pre-checked category via its label, then clicks Save", async () => {
    document.body.innerHTML = `
      <div id="onetrust-consent-sdk">
        <div id="onetrust-banner-sdk">
          <button id="onetrust-pc-btn-handler">Cookie Settings</button>
        </div>
        <div class="category-item">
          <div class="category-header">Performance Cookies</div>
          <label><input type="checkbox" class="category-switch-handler" checked />Performance Cookies</label>
        </div>
        <button class="save-preference-btn-handler">Save</button>
      </div>
    `;
    // Real OneTrust markup nests the checkbox inside its <label> (or links
    // it via `for`) so a label click natively toggles it -- same as here.
    markVisible("#onetrust-banner-sdk");

    const result = await runConsentRejection({ onetrust: ONETRUST_CONFIG });

    expect(result).toEqual({ handled: true, cmpName: "onetrust" });
    const checkbox = document.querySelector(".category-switch-handler") as HTMLInputElement;
    expect(checkbox.checked).toBe(false); // was checked, REJECT_ALL.B wants it off -- label must have been clicked
  });

  it("does not uncheck a category that's already off (no unnecessary click)", async () => {
    document.body.innerHTML = `
      <div id="onetrust-consent-sdk">
        <div id="onetrust-banner-sdk"><button id="onetrust-pc-btn-handler">Cookie Settings</button></div>
        <div class="category-item">
          <div class="category-header">Performance Cookies</div>
          <label><input type="checkbox" class="category-switch-handler" />Performance Cookies</label>
        </div>
        <button class="save-preference-btn-handler">Save</button>
      </div>
    `;
    markVisible("#onetrust-banner-sdk");
    const labelClicked = countClicksOn(".category-item label");

    await runConsentRejection({ onetrust: ONETRUST_CONFIG });

    expect(labelClicked()).toBe(0);
  });
});
