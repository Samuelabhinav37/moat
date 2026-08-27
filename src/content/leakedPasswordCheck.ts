// Isolated-world content script, top frame only, opt-in and off by default
// (Settings -> "Check passwords against known breaches"). Warns -- never
// blocks submission, never clears or modifies the field -- if a password
// typed into the page has appeared in a known data breach, checked via
// HaveIBeenPwned's Pwned Passwords k-anonymity API: only a 5-character
// SHA-1 prefix ever leaves the device (see shared/hibp.ts), never the full
// hash or the password itself.
//
// No MutationObserver needed to catch password fields that mount after
// load (e.g. an async login modal) -- blur/submit listeners registered on
// `document` with capture:true see every matching event regardless of when
// the field was added, the same event-delegation trick used for click
// handling elsewhere, just applied to a non-bubbling event (blur only
// fires during the capture phase for delegation purposes, never bubble).
import browser from "webextension-polyfill";
import { getEffectiveSettingsHere, isDisabled } from "./siteDisabled";
import { STORAGE_KEY } from "../types";
import { isSuffixInRangeResponse, sha1Hex, splitHashForRangeQuery } from "../shared/hibp";

async function isEnabled(): Promise<boolean> {
  const effective = await getEffectiveSettingsHere();
  return effective.leakedPasswordCheck && !isDisabled(effective);
}

// Avoids re-querying HIBP for a value already checked on this page (e.g. a
// "password" + "confirm password" pair, or blurring the same field twice
// without retyping) -- purely to cut redundant network calls, not a
// privacy requirement, since the query is already k-anonymized.
const lastChecked = new WeakMap<HTMLInputElement, string>();

async function checkPassword(input: HTMLInputElement): Promise<void> {
  const value = input.value;
  if (!value || lastChecked.get(input) === value) return;
  lastChecked.set(input, value);

  const hash = await sha1Hex(value);
  const { prefix, suffix } = splitHashForRangeQuery(hash);

  let body: string;
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!response.ok) return;
    body = await response.text();
  } catch {
    return; // best-effort -- a network hiccup just means no warning this time
  }

  if (isSuffixInRangeResponse(body, suffix)) showWarning(input);
}

function showWarning(input: HTMLInputElement): void {
  // Only ever show one live warning per field -- a second blur on the same
  // still-breached value would otherwise stack duplicate tooltips.
  if (input.dataset.moatLeakWarningShown === "true") return;
  input.dataset.moatLeakWarningShown = "true";

  const warning = document.createElement("div");
  warning.textContent = browser.i18n.getMessage("leakedPasswordWarning") || "This password has appeared in known data breaches.";
  Object.assign(warning.style, {
    position: "absolute",
    zIndex: "2147483647",
    background: "#3a2a1a",
    color: "#f0c987",
    font: "12px/1.4 system-ui, -apple-system, sans-serif",
    padding: "6px 10px",
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
    maxWidth: "260px",
  });

  const rect = input.getBoundingClientRect();
  warning.style.top = `${window.scrollY + rect.bottom + 4}px`;
  warning.style.left = `${window.scrollX + rect.left}px`;

  document.body.appendChild(warning);
  const remove = (): void => {
    warning.remove();
    delete input.dataset.moatLeakWarningShown;
  };
  input.addEventListener("focus", remove, { once: true });
  setTimeout(remove, 10000);
}

function isPasswordField(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === "password";
}

function onBlur(event: FocusEvent): void {
  if (!isPasswordField(event.target)) return;
  void checkPassword(event.target);
}

function onSubmit(event: SubmitEvent): void {
  if (!(event.target instanceof HTMLFormElement)) return;
  for (const input of event.target.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
    void checkPassword(input);
  }
}

let listening = false;

function attachListeners(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("blur", onBlur, true);
  document.addEventListener("submit", onSubmit, true);
}

function detachListeners(): void {
  if (!listening) return;
  listening = false;
  document.removeEventListener("blur", onBlur, true);
  document.removeEventListener("submit", onSubmit, true);
}

async function sync(): Promise<void> {
  if (await isEnabled()) attachListeners();
  else detachListeners();
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "managed" && !(area === "local" && STORAGE_KEY in changes)) return;
  void sync();
});

void sync();
