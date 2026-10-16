// Types for kaiWatch.js (when Kai's bubble shows, a copy from the
// portfolio). Importing the module for its side effect defines
// window.KaiWatch.

export type KaiNudgeKind = "welcome" | "back" | "say" | "stuck" | "looking" | "unsure";

export interface KaiWatchOptions {
  /** The window to watch; omit to feed signals by hand (tests). */
  win?: Window;
  /** Kai's corner and chat: nothing inside it counts. */
  kaiEl?: Element;
  show?: (kind: KaiNudgeKind, text: string) => void;
  hide?: () => void;
  /** True while the chat is open or Kai is hidden: no nudges then. */
  isOpen?: () => boolean;
  text?: { welcome?: string; back?: string; stuck?: string; looking?: string; unsure?: string; named?: string };
  /** A screen's name for "Need help with {name}?", or "" for none. */
  sectionName?: (id: string) => string;
  storageKey?: string;
  limits?: Partial<Record<string, number>>;
  now?: () => number;
}

export interface KaiWatch {
  /** The hello at most once a day: "welcome", "back" (a later day) or false. */
  welcome(text?: string, ms?: number): "welcome" | "back" | false;
  /** A short line after something the person did; never a nudge. */
  say(text: string, ms?: number): boolean;
  click(x: number, y: number): void;
  dead(): void;
  section(id: string, t?: number): void;
  flip(key: string): void;
  scroll(y: number, pane?: unknown): void;
  hesitated(): void;
  key(): void;
  opened(): void;
  isShowing(): KaiNudgeKind | null;
  fold(): void;
  stop(): void;
  state(): { n: number; ignored: number; opened: boolean; welcomed: boolean; showing: KaiNudgeKind | null };
}

declare global {
  interface Window {
    KaiWatch: (options?: KaiWatchOptions) => KaiWatch;
  }
}
