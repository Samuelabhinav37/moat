// The Settings dashboard: a sidebar with one screen per task, picked by the
// URL hash (#paused, #filters, ...) so Back and bookmarks work. Every section
// stays in the page; this only marks which ones belong to the current
// screen, and the CSS hides the rest. Same at every width: navMode.ts only
// changes how the sidebar itself is shown.

export const PAGE_KEYS = ["overview", "protection", "exceptions", "trackers", "sites", "security", "about"] as const;
export type PageKey = (typeof PAGE_KEYS)[number];
export const DEFAULT_PAGE: PageKey = "overview";

/** Screens that were folded into another, so old links and bookmarks still
 * land, on the right card where there is one. */
const MOVED: Record<string, { page: PageKey; anchor?: string; tab?: string }> = {
  paused: { page: "exceptions", tab: "paused" },
  hidden: { page: "exceptions", tab: "hidden" },
  rules: { page: "exceptions", tab: "rules" },
  backup: { page: "about", anchor: "a-backup" },
  blocking: { page: "protection", anchor: "p-level" },
  privacy: { page: "protection", anchor: "p-privacy" },
  filters: { page: "protection", anchor: "p-lists" },
};

export function pageFromHash(hash: string): PageKey {
  const key = hash.replace(/^#/, "");
  if (MOVED[key]) return MOVED[key].page;
  return (PAGE_KEYS as readonly string[]).includes(key) ? (key as PageKey) : DEFAULT_PAGE;
}

/** The tab an old screen's link should open, if any. */
export function tabFromHash(hash: string): string | null {
  return MOVED[hash.replace(/^#/, "")]?.tab ?? null;
}

/** Which tab each tabbed screen is on (the first tab until one is picked). */
const currentTab = new Map<string, string>();

function tabsOf(root: Document, key: string): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`section[data-page="${key}"][data-tab]`))
    .map((s) => s.dataset.tab!)
    .filter((t, i, all) => all.indexOf(t) === i);
}

/** Shows one tab of a tabbed screen: its sections, its button as selected,
 * and the sliding highlight under it. */
export function showTab(key: string, tab: string, root: Document = document): void {
  currentTab.set(key, tab);
  showPage(key as PageKey, root);
}

/** Opens whatever tab holds `target` (search results use this). */
export function revealTab(target: HTMLElement, root: Document = document): void {
  const section = target.closest<HTMLElement>("section[data-page][data-tab]");
  if (section && currentTab.get(section.dataset.page!) !== section.dataset.tab) showTab(section.dataset.page!, section.dataset.tab!, root);
}

function syncTabButtons(root: Document, tab: string | undefined): void {
  for (const btn of root.querySelectorAll<HTMLElement>("[data-tab-btn]")) {
    const on = btn.dataset.tabBtn === tab;
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
    if (!on) continue;
    const pill = btn.parentElement?.querySelector<HTMLElement>(".pill");
    if (pill) {
      pill.style.width = `${btn.offsetWidth}px`;
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    }
  }
}

/** The card an old screen's link should scroll to, if any. */
export function anchorFromHash(hash: string): string | null {
  return MOVED[hash.replace(/^#/, "")]?.anchor ?? null;
}

/** Marks the sections and panels of one screen as shown and the rest as
 * off, and points the sidebar and page heading at it. */
export function showPage(key: PageKey, root: Document = document): void {
  const sections = Array.from(root.querySelectorAll<HTMLElement>("section[data-page]"));
  const tabs = tabsOf(root, key);
  const tab = tabs.length ? (tabs.includes(currentTab.get(key) ?? "") ? currentTab.get(key)! : tabs[0]!) : undefined;
  for (const section of sections) {
    section.classList.toggle("dash-off", section.dataset.page !== key);
    section.classList.toggle("tab-off", section.dataset.page === key && !!section.dataset.tab && section.dataset.tab !== tab);
  }
  const visible = sections.filter((section) => section.dataset.page === key && !section.classList.contains("tab-off"));
  if (tab) syncTabButtons(root, tab);
  visible.forEach((section, i) => {
    // First on the screen, or first inside its card (no divider above it).
    const panel = section.closest(".panel");
    const firstInPanel = panel ? visible.find((v) => panel.contains(v)) === section : false;
    section.classList.toggle("dash-first", i === 0 || firstInPanel);
    // A screen with a single section uses its sentence as the subtitle, so
    // the section's own heading block is hidden (see the CSS).
    section.classList.toggle("dash-solo", visible.length === 1);
  });
  for (const panel of root.querySelectorAll<HTMLElement>(".panel")) {
    panel.classList.toggle("dash-off", !visible.some((section) => panel.contains(section)));
  }

  let link: HTMLElement | null = null;
  for (const a of root.querySelectorAll<HTMLElement>(".dash-nav a[data-page]")) {
    const current = a.dataset.page === key;
    if (current) {
      a.setAttribute("aria-current", "page");
      link = a;
    } else {
      a.removeAttribute("aria-current");
    }
  }
  const title = root.getElementById("page-title");
  const lead = root.getElementById("page-lead");
  if (title) title.textContent = link?.querySelector(".nav-name")?.textContent ?? "";
  const soloLead = visible.length === 1 ? visible[0]!.querySelector(".lead")?.textContent : null;
  if (lead) lead.textContent = soloLead ?? link?.querySelector(".nav-lead")?.textContent ?? "";
}

/** Keeps a sidebar count in step with the rows of one or more lists. */
function watchCount(countEl: HTMLElement, lists: HTMLElement[]): void {
  const update = () => {
    const count = lists.reduce((sum, list) => sum + list.children.length, 0);
    countEl.textContent = count ? count.toLocaleString() : "";
    countEl.hidden = count === 0;
  };
  const observer = new MutationObserver(update);
  for (const list of lists) observer.observe(list, { childList: true });
  update();
}

/** `onShow` runs after each screen change (the "How it works" panel follows it). */
export function initDashboard(win: Window = window, onShow?: (key: PageKey) => void): void {
  const doc = win.document;
  const show = () => {
    const key = pageFromHash(win.location.hash);
    const tab = tabFromHash(win.location.hash);
    if (tab) currentTab.set(key, tab);
    showPage(key, doc);
    onShow?.(key);
    const anchor = anchorFromHash(win.location.hash);
    const target = anchor ? doc.getElementById(anchor) : null;
    if (!target) {
      win.scrollTo?.(0, 0);
      return;
    }
    // The cards above fill in as their data arrives, which pushes the target
    // down: land again a moment later unless the reader has scrolled.
    let moved = false;
    const stop = () => (moved = true);
    for (const type of ["wheel", "touchstart", "keydown"]) win.addEventListener(type, stop, { once: true, passive: true });
    const land = () => !moved && target.scrollIntoView?.({ block: "start" });
    land();
    win.setTimeout?.(land, 350);
    win.setTimeout?.(land, 1000);
  };
  win.addEventListener("hashchange", show);
  show();
  initJumpChips(win);

  for (const btn of doc.querySelectorAll<HTMLElement>("[data-tab-btn]")) {
    btn.addEventListener("click", () => showTab(pageFromHash(win.location.hash), btn.dataset.tabBtn!, doc));
    // Arrow keys move between tabs, as in any tab list.
    btn.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const all = Array.from(btn.parentElement!.querySelectorAll<HTMLElement>("[data-tab-btn]")).filter((b) => !b.hidden);
      const next = all[(all.indexOf(btn) + (event.key === "ArrowRight" ? 1 : all.length - 1)) % all.length]!;
      next.click();
      next.focus();
    });
  }
  win.addEventListener("resize", () => syncTabButtons(doc, currentTab.get(pageFromHash(win.location.hash))));

  const lists = (...ids: string[]) => ids.map((id) => doc.getElementById(id)).filter((el): el is HTMLElement => el !== null);
  const counts: [string, HTMLElement[]][] = [
    ["tab-count-paused", lists("site-list")],
    ["tab-count-persite", lists("override-list")],
    ["tab-count-hidden", lists("hidden-element-rows", "grayscale-element-rows")],
    ["tab-count-rules", lists("custom-block-list", "custom-allow-list")],
    ["nav-count-exceptions", lists("site-list", "override-list", "hidden-element-rows", "grayscale-element-rows", "custom-block-list", "custom-allow-list")],
  ];
  for (const [id, els] of counts) {
    const el = doc.getElementById(id);
    if (el && els.length) watchCount(el, els);
  }
}

/** "On this page" chips: scroll to their card (without changing the hash,
 * which names the screen) and follow the card in view. */
function initJumpChips(win: Window): void {
  const doc = win.document;
  const chips = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[data-jump]"));
  if (!chips.length) return;
  const reduced = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  for (const chip of chips) {
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      doc.getElementById(chip.dataset.jump ?? "")?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
  }
  const follow = () => {
    const visible = chips.filter((chip) => chip.offsetParent !== null);
    if (!visible.length) return;
    let current = visible[0]!.dataset.jump;
    for (const chip of visible) {
      const card = doc.getElementById(chip.dataset.jump ?? "");
      if (card && card.getBoundingClientRect().top < 180) current = chip.dataset.jump;
    }
    for (const chip of visible) chip.classList.toggle("on", chip.dataset.jump === current);
  };
  win.addEventListener("scroll", follow, { passive: true });
  win.addEventListener("hashchange", () => win.setTimeout(follow, 50));
  follow();
}
