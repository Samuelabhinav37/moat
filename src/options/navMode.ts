// The Settings sidebar in three sizes, the way Google Cloud and Azure do it:
// a full sidebar on wide windows (the menu button beside the logo folds it
// to icons, and that choice is remembered), an icon rail on medium windows,
// and a drawer that slides over the page on narrow ones. Where the full
// sidebar doesn't fit, the button opens it over the page. Before this, the
// sidebar simply disappeared below 900px and the page became one long list.

export type NavMode = "full" | "icons" | "drawer";
export type NavPreference = "full" | "icons";

export const DRAWER_BELOW = 720;
export const ICONS_BELOW = 1100;
export const PREF_KEY = "moat-nav";

/** The mode for a window width. The user's preference only applies where
 * the full sidebar fits. */
export function modeFor(width: number, preference: NavPreference): NavMode {
  if (width < DRAWER_BELOW) return "drawer";
  if (width < ICONS_BELOW) return "icons";
  return preference;
}

export function readPreference(
  storage: Pick<Storage, "getItem"> | null,
): NavPreference {
  try {
    return storage?.getItem(PREF_KEY) === "icons" ? "icons" : "full";
  } catch {
    return "full";
  }
}

export interface NavLabels {
  collapse: string;
  expand: string;
  open: string;
  close: string;
}

export function initNavMode(
  win: Window,
  labels: NavLabels,
): { mode: () => NavMode; destroy: () => void } {
  const doc = win.document;
  const body = doc.body;
  const toggle = doc.getElementById("nav-toggle") as HTMLButtonElement | null;
  const nav = doc.getElementById("dash-nav");
  const scrim = doc.getElementById("nav-scrim");
  if (!toggle || !nav) return { mode: () => "full", destroy: () => {} };
  const off = new AbortController();
  const signal = off.signal;
  let storage: Storage | null = null;
  try {
    storage = win.localStorage;
  } catch {
    storage = null;
  }
  let preference = readPreference(storage);
  let mode: NavMode = modeFor(win.innerWidth, preference);

  for (const link of nav.querySelectorAll<HTMLElement>("a[data-nav-link]")) {
    link.dataset.tip =
      link.querySelector(".nav-name")?.textContent?.trim() ?? "";
  }

  const isOpen = () => body.classList.contains("nav-open");
  // Where the full sidebar doesn't fit (drawer, and the icon rail of a
  // medium window) the button opens it over the page instead.
  const overlay = () =>
    mode === "drawer" || (mode === "icons" && win.innerWidth < ICONS_BELOW);
  const label = () => {
    const text = overlay()
      ? isOpen()
        ? labels.close
        : labels.open
      : mode === "full"
        ? labels.collapse
        : labels.expand;
    toggle.setAttribute("aria-label", text);
    toggle.title = text;
    toggle.setAttribute(
      "aria-expanded",
      String(overlay() ? isOpen() : mode === "full"),
    );
  };
  const setOpen = (open: boolean, returnFocus = false) => {
    body.classList.toggle("nav-open", open && overlay());
    if (scrim) scrim.hidden = !(open && overlay());
    label();
    if (open) nav.querySelector<HTMLElement>("a[aria-current]")?.focus();
    else if (returnFocus) toggle.focus();
  };
  const apply = () => {
    const next = modeFor(win.innerWidth, preference);
    if (next !== mode || body.dataset.nav !== next) {
      mode = next;
      body.dataset.nav = mode;
      setOpen(false);
    }
    // The menu lines turn into an "expand" arrow only when the user folded it.
    body.classList.toggle("nav-folded", mode === "icons" && !overlay());
    label();
  };

  toggle.addEventListener(
    "click",
    () => {
      if (overlay()) {
        setOpen(!isOpen());
        return;
      }
      preference = preference === "full" ? "icons" : "full";
      try {
        storage?.setItem(PREF_KEY, preference);
      } catch {
        // Storage blocked: the choice lasts for this page only.
      }
      apply();
    },
    { signal },
  );
  scrim?.addEventListener("click", () => setOpen(false), { signal });
  // Picking a screen from the drawer closes it.
  nav.addEventListener(
    "click",
    (event) => {
      if (mode === "drawer" && (event.target as HTMLElement).closest("a"))
        setOpen(false);
    },
    { signal },
  );
  doc.addEventListener(
    "keydown",
    (event) => {
      if (!isOpen()) return;
      if (event.key === "Escape") {
        setOpen(false, true);
        return;
      }
      if (event.key !== "Tab") return;
      // Keep keyboard focus inside the open drawer (and its button).
      const stops = [toggle, ...nav.querySelectorAll<HTMLElement>("a")];
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    { signal },
  );
  win.addEventListener("resize", apply, { signal });
  body.dataset.nav = mode;
  apply();
  return { mode: () => mode, destroy: () => off.abort() };
}
