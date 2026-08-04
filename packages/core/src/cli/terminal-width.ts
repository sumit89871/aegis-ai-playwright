import { ANSI_RESET } from "./ansi-styles.ts";

const ESCAPE = String.fromCodePoint(27);
const ANSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "gu");
const ANSI_OR_CODE_POINT_PATTERN = new RegExp(
  `${ESCAPE}\\[[0-?]*[ -/]*[@-~]|[\\s\\S]`,
  "gu",
);

function codePointWidth(value: string): number {
  const codePoint = value.codePointAt(0) ?? 0;
  if (
    codePoint === 0 ||
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint < 0xa0) ||
    codePoint === 0x200d ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  )
    return 0;
  if (
    /\p{Extended_Pictographic}/u.test(value) ||
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  )
    return 2;
  return 1;
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function visibleWidth(value: string): number {
  return (stripAnsi(value).match(/[\s\S]/gu) ?? []).reduce(
    (total, codePoint) => total + codePointWidth(codePoint),
    0,
  );
}

export function truncateToWidth(value: string, maximumWidth: number): string {
  if (maximumWidth <= 0) return "";
  let width = 0;
  let truncated = false;
  let containedAnsi = false;
  const output: string[] = [];
  for (const token of value.match(ANSI_OR_CODE_POINT_PATTERN) ?? []) {
    if (token.startsWith("\u001B[")) {
      containedAnsi = true;
      output.push(token);
      continue;
    }
    const tokenWidth = codePointWidth(token);
    if (width + tokenWidth > maximumWidth) {
      truncated = true;
      break;
    }
    output.push(token);
    width += tokenWidth;
  }
  if (truncated && containedAnsi) output.push(ANSI_RESET);
  return output.join("");
}

export function splitAtVisibleWidth(
  value: string,
  maximumWidth: number,
): readonly [head: string, tail: string] {
  if (maximumWidth <= 0) return ["", value];
  let width = 0;
  let consumedCodeUnits = 0;
  let containedAnsi = false;
  const output: string[] = [];
  for (const token of value.match(ANSI_OR_CODE_POINT_PATTERN) ?? []) {
    if (token.startsWith("\u001B[")) {
      containedAnsi = true;
      output.push(token);
      consumedCodeUnits += token.length;
      continue;
    }
    const tokenWidth = codePointWidth(token);
    if (width + tokenWidth > maximumWidth) break;
    output.push(token);
    width += tokenWidth;
    consumedCodeUnits += token.length;
  }
  const tail = value.slice(consumedCodeUnits);
  if (tail !== "" && containedAnsi) output.push(ANSI_RESET);
  return [output.join(""), tail];
}

export function padToWidth(value: string, width: number): string {
  const bounded = truncateToWidth(value, width);
  return `${bounded}${" ".repeat(Math.max(0, width - visibleWidth(bounded)))}`;
}
