// The document pages' behaviour (privacy.html, changelog.html, licenses.html,
// built by scripts/docs/buildDocs.mjs). Extension pages can't run inline
// script, so everything lives here and checks for its own elements.

// Not in English? Say so, and give the page's short version in the
// browser's language (Mozilla publishes a short summary per language too).
// The full text stays English, the version that's kept exact.
const langNote = document.getElementById("lang-note");
const i18n = globalThis.chrome?.i18n;
const uiLang = i18n?.getUILanguage?.() ?? "en";
if (langNote && i18n && !/^en\b/i.test(uiLang)) {
  const doc = langNote.dataset.doc ?? "";
  const keys: Record<string, string> = { privacy: "docSummaryPrivacy", changelog: "docSummaryChangelog", licenses: "docSummaryLicenses" };
  const summary = keys[doc] ? i18n.getMessage(keys[doc]) : "";
  const intro = i18n.getMessage("docInEnglish");
  if (intro && summary) {
    langNote.lang = uiLang;
    langNote.append(Object.assign(document.createElement("b"), { textContent: intro }), document.createTextNode(` ${summary}`));
    langNote.hidden = false;
  }
}

// "On this page": highlight the section in view.
const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-toc]")];
if (tocLinks.length && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) for (const link of tocLinks) link.classList.toggle("on", link.dataset.toc === entry.target.id);
      }
    },
    { rootMargin: "-80px 0px -70% 0px" }
  );
  for (const link of tocLinks) {
    const target = document.getElementById(link.dataset.toc ?? "");
    if (target) observer.observe(target);
  }
}

// Phones: the contents list is a jump menu.
document.querySelector<HTMLSelectElement>("[data-tocm]")?.addEventListener("change", (event) => {
  const target = document.getElementById((event.target as HTMLSelectElement).value);
  if (!target) return;
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView();
});

// Changelog: filter by kind of change, and search.
const search = document.getElementById("q") as HTMLInputElement | null;
const filters = [...document.querySelectorAll<HTMLButtonElement>("[data-f]")];
if (search && filters.length) {
  let kind = "all";
  const apply = () => {
    const text = search.value.toLowerCase();
    let shown = 0;
    for (const release of document.querySelectorAll<HTMLElement>(".rel")) {
      const ok = (kind === "all" || (release.dataset.kinds ?? "").split(" ").includes(kind)) && (!text || (release.textContent ?? "").toLowerCase().includes(text));
      release.hidden = !ok;
      if (ok) shown++;
      for (const part of release.querySelectorAll<HTMLElement>(".part")) {
        part.hidden = kind !== "all" && !(part.querySelector(".tag")?.textContent ?? "").toLowerCase().startsWith(kind);
      }
    }
    const none = document.getElementById("none");
    if (none) none.hidden = shown > 0;
  };
  for (const button of filters) {
    button.addEventListener("click", () => {
      kind = button.dataset.f ?? "all";
      for (const b of filters) b.setAttribute("aria-selected", String(b === button));
      apply();
    });
  }
  search.addEventListener("input", apply);
}

// Licenses: the Source link inside a row's summary opens the link, not the row.
for (const link of document.querySelectorAll<HTMLAnchorElement>(".lic summary .src")) {
  link.addEventListener("click", (event) => event.stopPropagation());
}
