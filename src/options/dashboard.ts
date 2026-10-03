// The Settings dashboard: a sidebar with one screen per task, picked by the
// URL hash (#paused, #filters, ...) so Back and bookmarks work. Every section
// stays in the page; this only marks which ones belong to the current
// screen, and the CSS hides the rest. Same at every width: navMode.ts only
// changes how the sidebar itself is shown.

export const PAGE_KEYS = ["overview", "blocking", "privacy", "filters", "paused", "hidden", "rules", "backup", "about"] as const;
export type PageKey = (typeof PAGE_KEYS)[number];
export const DEFAULT_PAGE: PageKey = "overview";

/** Screens that were folded into another, so old links still land. */
const MOVED: Record<string, PageKey> = { trackers: "overview" };

export function pageFromHash(hash: string): PageKey {
  const key = hash.replace(/^#/, "");
  if (MOVED[key]) return MOVED[key];
  return (PAGE_KEYS as readonly string[]).includes(key) ? (key as PageKey) : DEFAULT_PAGE;
}

/** Marks the sections and panels of one screen as shown and the rest as
 * off, and points the sidebar and page heading at it. */
export function showPage(key: PageKey, root: Document = document): void {
  const sections = Array.from(root.querySelectorAll<HTMLElement>("section[data-page]"));
  for (const section of sections) section.classList.toggle("dash-off", section.dataset.page !== key);
  const visible = sections.filter((section) => section.dataset.page === key);
  visible.forEach((section, i) => {
    section.classList.toggle("dash-first", i === 0);
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
    showPage(key, doc);
    onShow?.(key);
    win.scrollTo?.(0, 0);
  };
  win.addEventListener("hashchange", show);
  const first = pageFromHash(win.location.hash);
  showPage(first, doc);
  onShow?.(first);

  const byId = (id: string) => doc.getElementById(id);
  const pausedCount = byId("nav-count-paused");
  const hiddenCount = byId("nav-count-hidden");
  const siteList = byId("site-list");
  const overrideList = byId("override-list");
  const hiddenRows = byId("hidden-element-rows");
  const grayRows = byId("grayscale-element-rows");
  if (pausedCount && siteList) watchCount(pausedCount, overrideList ? [siteList, overrideList] : [siteList]);
  if (hiddenCount && hiddenRows) watchCount(hiddenCount, grayRows ? [hiddenRows, grayRows] : [hiddenRows]);
}
