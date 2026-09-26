// The small confirmation toast on the Settings page. "Saved" shows when the
// stored settings change shortly after the person did something on this
// page, so a background write (startup migration, a sync pull) never
// flashes it on its own. After a removal it offers Undo instead, and stays
// a little longer so there's time to use it.

export const INTERACTION_WINDOW_MS = 4000;
export const TOAST_MS = 1800;
export const UNDO_MS = 6000;

export function shouldConfirm(now: number, lastInteraction: number): boolean {
  return now - lastInteraction >= 0 && now - lastInteraction < INTERACTION_WINDOW_MS;
}

export function createSavedToast(el: HTMLElement, label: HTMLElement, action: HTMLButtonElement | null = null, win: Window = window) {
  let lastInteraction = -Infinity;
  let timer: number | undefined;
  let onAction: (() => void) | null = null;
  const mark = () => {
    lastInteraction = Date.now();
  };
  for (const type of ["click", "change", "keydown"]) win.document.addEventListener(type, mark, true);

  const hide = () => {
    el.classList.remove("show");
    el.hidden = true;
    onAction = null;
    if (action) action.hidden = true;
  };

  const open = (text: string, ms: number) => {
    label.textContent = text;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    if (timer !== undefined) win.clearTimeout(timer);
    timer = win.setTimeout(hide, ms);
  };

  action?.addEventListener("click", () => {
    const run = onAction;
    hide();
    run?.();
  });

  return {
    show(text: string): void {
      onAction = null;
      if (action) action.hidden = true;
      open(text, TOAST_MS);
    },
    /** "Resumed reddit.com · Undo". The removal's own "Saved" is skipped
     * while this is showing, so it isn't replaced before it can be used. */
    offerUndo(text: string, undoLabel: string, undo: () => void): void {
      onAction = undo;
      if (action) {
        action.textContent = undoLabel;
        action.hidden = false;
      }
      open(text, UNDO_MS);
    },
    /** Call when the settings in storage changed. */
    settingsChanged(text: string): void {
      if (onAction) return;
      if (shouldConfirm(Date.now(), lastInteraction)) this.show(text);
    },
  };
}
