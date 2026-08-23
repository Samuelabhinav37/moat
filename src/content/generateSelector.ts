// Pure DOM-to-CSS-selector logic behind the element picker
// (elementPicker.ts). Takes whatever the user clicked and produces a
// selector specific enough to target it (and its likely siblings/repeats)
// without being so narrow it breaks the moment the page re-renders.

const MAX_ANCESTOR_DEPTH = 3;

/** Heuristic for "this identifier looks machine-generated, don't rely on it". */
function looksGenerated(value: string): boolean {
  if (value.length < 2) return true;
  if (/\d{4,}/.test(value)) return true; // long digit runs (ids like "ad-slot-48213")
  if (/^[a-f0-9]{6,}$/i.test(value)) return true; // pure hex/hash-looking
  if (/^[a-z]{1,3}-[a-z0-9]{5,}$/i.test(value)) return true; // "css-1a2b3c4", "sc-bdVaJa" style
  return false;
}

function stableId(element: Element): string | null {
  const id = element.id;
  return id && !looksGenerated(id) ? id : null;
}

function stableClasses(element: Element): string[] {
  return [...element.classList].filter((cls) => !looksGenerated(cls)).slice(0, 2);
}

function structuralPath(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;

  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && node; depth += 1) {
    const parent: Element | null = node.parentElement;
    const tag = node.tagName.toLowerCase();
    if (parent) {
      const index = [...parent.children].indexOf(node) + 1;
      parts.unshift(`${tag}:nth-child(${index})`);
    } else {
      parts.unshift(tag);
    }
    node = parent;
  }

  return parts.join(" > ");
}

/** Never a sensible target -- picking these is almost certainly a stray hover/misclick. */
export function isUnpickable(element: Element): boolean {
  const tag = element.tagName?.toLowerCase();
  return tag === "html" || tag === "body";
}

export function generateSelector(element: Element): string {
  const id = stableId(element);
  if (id) return `#${CSS.escape(id)}`;

  const classes = stableClasses(element);
  if (classes.length > 0) {
    return `${element.tagName.toLowerCase()}${classes.map((c) => `.${CSS.escape(c)}`).join("")}`;
  }

  return structuralPath(element);
}
