export const ANSI_RESET = "\u001B[0m";
export const ANSI_BRIGHT = "\u001B[1m";
export const ANSI_DIM = "\u001B[2m";
export const ANSI_NORMAL = "\u001B[22m";

export const ANSI_STYLE = Object.freeze({
  reset: ANSI_RESET,
  bright: ANSI_BRIGHT,
  dim: ANSI_DIM,
  normal: ANSI_NORMAL,
  cyan: "\u001B[36m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
  clearLine: "\u001B[2K",
  hideCursor: "\u001B[?25l",
  showCursor: "\u001B[?25h",
});

export const THINKING_BRIGHTNESS_FRAMES = Object.freeze([
  ANSI_DIM,
  ANSI_NORMAL,
  ANSI_BRIGHT,
  ANSI_NORMAL,
  ANSI_DIM,
  ANSI_NORMAL,
]);
