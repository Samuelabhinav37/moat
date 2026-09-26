// Whether Moat's toolbar button is pinned, for the first-run tour's pin step.
// action.getUserSettings() (Chrome 91+, Firefox MV3) reports it; no API can
// pin the extension itself, so the tour can only guide and then notice.
// action.onUserSettingsChanged (Chrome 130+) says the moment it changes;
// elsewhere this re-checks on a short interval while the step is open.

export type PinState = "pinned" | "unpinned" | "unknown";

interface UserSettings {
  isOnToolbar?: boolean;
}

/** The slice of the action API this needs, so tests can pass a fake. */
export interface ActionLike {
  getUserSettings?: () => Promise<UserSettings>;
  onUserSettingsChanged?: {
    addListener(listener: (change: UserSettings) => void): void;
    removeListener(listener: (change: UserSettings) => void): void;
  };
}

export async function readPinState(action: ActionLike | undefined): Promise<PinState> {
  if (typeof action?.getUserSettings !== "function") return "unknown";
  try {
    const settings = await action.getUserSettings();
    if (typeof settings?.isOnToolbar !== "boolean") return "unknown";
    return settings.isOnToolbar ? "pinned" : "unpinned";
  } catch {
    return "unknown";
  }
}

/** Calls onChange with the current state, then again whenever it changes.
 * Returns a function that stops watching. */
export function watchPinState(
  action: ActionLike | undefined,
  onChange: (state: PinState) => void,
  pollMs = 1000
): () => void {
  let last: PinState | undefined;
  let stopped = false;
  const report = (state: PinState) => {
    if (stopped || state === last) return;
    last = state;
    onChange(state);
  };
  const check = () => void readPinState(action).then(report);

  check();
  const event = action?.onUserSettingsChanged;
  if (event) {
    const listener = (change: UserSettings) => {
      if (typeof change?.isOnToolbar === "boolean") report(change.isOnToolbar ? "pinned" : "unpinned");
    };
    event.addListener(listener);
    return () => {
      stopped = true;
      event.removeListener(listener);
    };
  }
  const timer = setInterval(check, pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
