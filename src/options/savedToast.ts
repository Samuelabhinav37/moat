// The small "Saved" confirmation on the Settings page. It shows when the
// stored settings change shortly after the person did something on this
// page, so a background write (startup migration, a sync pull) never
// flashes it on its own.

export const INTERACTION_WINDOW_MS = 4000;
export const TOAST_MS = 1800;

export function shouldConfirm(now: number, lastInteraction: number): boolean {
  return now - lastInteraction >= 0 && now - lastInteraction < INTERACTION_WINDOW_MS;
}

export function createSavedToast(el: HTMLElement, label: HTMLElement, win: Window = window) {
  let lastInteraction = -Infinity;
  let timer: number | undefined;
  const mark = () => {
    lastInteraction = Date.now();
  };
  for (const type of ["click", "change", "keydown"]) win.document.addEventListener(type, mark, true);

  const show = (text: string) => {
    label.textContent = text;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    if (timer !== undefined) win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      el.classList.remove("show");
      el.hidden = true;
    }, TOAST_MS);
  };

  return {
    show,
    /** Call when the settings in storage changed. */
    settingsChanged(text: string): void {
      if (shouldConfirm(Date.now(), lastInteraction)) show(text);
    },
  };
}
