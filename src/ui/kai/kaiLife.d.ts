// Types for kaiLife.js (Kai's engine, a copy from the portfolio). Importing
// the module for its side effect defines window.Kai.

export type KaiMood =
  | "neutral" | "happy" | "joyful" | "curious" | "thinking" | "focused"
  | "surprised" | "scared" | "sad" | "shy" | "sleepy" | "asleep"
  | "proud" | "suspicious" | "worried";

export type KaiAction =
  | "blink" | "wink" | "hop" | "nod" | "shake" | "tilt" | "wave" | "wiggle"
  | "stretch" | "yawn" | "startle" | "celebrate" | "lookAround" | "shy"
  | "glitch" | "dizzy"
  | "nodSmall" | "shrug" | "peek" | "point" | "relief" | "puff" | "bye" | "lookAway" | "squint";

export interface KaiOptions {
  /** Folder holding kai-body.w{160,320,640}.webp and kai-antenna.*, with a trailing slash. */
  src?: string;
  /** Which image width to load: 160, 320 or 640. */
  imgWidth?: 160 | 320 | 640;
  /** No float or breathing, and no frames at all while Kai is still. */
  calm?: boolean;
  /** Kai decides what to do by itself (pointer, scroll, idle, sleep). */
  auto?: boolean;
  /** With `auto`: how long without input before Kai gets sleepy, in ms (default 60000). */
  sleepAfter?: number;
  /** Without a brain, still blink now and then (default true). */
  blinks?: boolean;
  /** Skip the eye glow (very small Kais). */
  lite?: boolean;
}

export interface KaiInstance {
  readonly root: HTMLElement;
  mood: string;
  thinking: boolean;
  setMood(mood: KaiMood, ms?: number): void;
  do(action: KaiAction): void;
  blink(double?: boolean): void;
  lookAt(target: Element | { x: number; y: number } | null): void;
  /** Glance at a spot and lean the antenna toward it (before "Show me"). */
  pointAt(target: Element | { x: number; y: number } | null): void;
  talk(ms?: number): void;
  think(on: boolean): void;
  lightAntenna(ms?: number): void;
  react(kind: "found" | "miss" | "hello" | "joke", replyLength?: number): void;
}

export interface KaiFactory {
  (root: HTMLElement, options?: KaiOptions): KaiInstance;
  readonly MOODS: KaiMood[];
  readonly ACTIONS: KaiAction[];
}

declare global {
  interface Window {
    Kai: KaiFactory;
  }
}
