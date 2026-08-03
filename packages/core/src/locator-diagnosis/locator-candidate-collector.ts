import type { Locator, Page } from "@playwright/test";

import { redactSensitiveText } from "../diagnostics/redaction.ts";
import type {
  CandidateScoreInput,
  LocatorCandidateInventory,
  LocatorCandidateStrategy,
} from "./locator-candidate.ts";
import { MAX_LOCATOR_CANDIDATES } from "./locator-candidate.ts";
import { rankLocatorCandidates } from "./locator-candidate-scorer.ts";
import type { LocatorTargetIntent } from "./locator-failure-classifier.ts";

export interface LocatorCandidateCollectionOptions {
  readonly maximumCandidates?: number;
  readonly maximumCandidateTextLength?: number;
  readonly includeHiddenCandidates?: boolean;
  readonly includeDisabledCandidates?: boolean;
}

interface BrowserCandidateElement {
  readonly tagName: string;
  readonly role: string | null;
  readonly ariaLabel: string | null;
  readonly label: string | null;
  readonly placeholder: string | null;
  readonly testId: string | null;
  readonly alt: string | null;
  readonly title: string | null;
  readonly stableId: string | null;
  readonly stableClass: string | null;
  readonly text: string | null;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly editable: boolean;
  readonly hasBoundingBox: boolean;
}

interface BrowserCollectionResult {
  readonly elements: readonly BrowserCandidateElement[];
  readonly matchedElementCount: number;
}

interface BrowserElementLike {
  readonly tagName?: string;
  readonly textContent?: string | null;
  readonly className?: unknown;
  readonly labels?: readonly { readonly textContent?: string | null }[] | null;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly isContentEditable?: boolean;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { readonly width: number; readonly height: number };
}

const COLLECTION_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden']):not([type='password'])",
  "textarea",
  "select",
  "[role]",
  "[aria-label]",
  "[data-testid]",
  "img[alt]",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "[contenteditable='true']",
  "[id]",
].join(",");

const STABLE_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/u;
const GENERATED_TOKEN =
  /(?:^|[-_])(?:css|sc|jsx|ember|react|ng)[-_]?[a-f0-9]{5,}|[a-f0-9]{12,}|\d{6,}/iu;

function bounded(value: string | null, limit: number): string | undefined {
  if (value === null || value.trim().length === 0) return undefined;
  return redactSensitiveText(value.replace(/\s+/gu, " ").trim(), limit);
}

function implicitRole(
  tagName: string,
  type: string | null,
): string | undefined {
  if (tagName === "button") return "button";
  if (tagName === "a") return "link";
  if (tagName === "select") return "combobox";
  if (tagName === "textarea") return "textbox";
  if (/^h[1-6]$/u.test(tagName)) return "heading";
  if (tagName === "img") return "img";
  if (tagName === "input") {
    if (["button", "submit", "reset"].includes(type ?? "")) return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    return "textbox";
  }
  return undefined;
}

function stableToken(value: string | undefined): string | undefined {
  return value !== undefined &&
    STABLE_TOKEN.test(value) &&
    !GENERATED_TOKEN.test(value)
    ? value
    : undefined;
}

function locatorFor(
  page: Page,
  candidate: CandidateScoreInput,
): Locator | undefined {
  const value = candidate.value ?? "";
  switch (candidate.strategy) {
    case "role":
      return page.getByRole(
        candidate.role as Parameters<Page["getByRole"]>[0],
        { name: candidate.name ?? "", exact: true },
      );
    case "label":
      return page.getByLabel(value, { exact: true });
    case "placeholder":
      return page.getByPlaceholder(value, { exact: true });
    case "test-id":
      return page.getByTestId(value);
    case "text":
      return page.getByText(value, { exact: true });
    case "alt-text":
      return page.getByAltText(value, { exact: true });
    case "title":
      return page.getByTitle(value, { exact: true });
    case "stable-id":
      return page.locator(`[id=${JSON.stringify(value)}]`);
    case "scoped-css":
      return page.locator(value);
    case "unsupported":
      return undefined;
  }
}

async function withCount(
  page: Page,
  candidate: Omit<CandidateScoreInput, "matchCount" | "countError">,
): Promise<CandidateScoreInput> {
  try {
    const locator = locatorFor(page, { ...candidate, matchCount: null });
    if (locator === undefined) return { ...candidate, matchCount: null };
    return { ...candidate, matchCount: await locator.count() };
  } catch (error) {
    return {
      ...candidate,
      matchCount: null,
      countError: redactSensitiveText(
        error instanceof Error ? error.message : "Candidate count unavailable.",
        300,
      ),
    };
  }
}

function descriptor(
  element: BrowserCandidateElement,
  strategy: LocatorCandidateStrategy,
  fields: {
    readonly role?: string;
    readonly name?: string;
    readonly value?: string;
  },
  weakAccessibleNameApproximation = false,
): Omit<CandidateScoreInput, "matchCount" | "countError"> {
  return Object.freeze({
    strategy,
    ...fields,
    exact: true,
    scopeHint: null,
    tagName: element.tagName,
    visible: element.visible,
    enabled: element.enabled,
    editable: element.editable,
    hasBoundingBox: element.hasBoundingBox,
    weakAccessibleNameApproximation,
  });
}

function descriptorsFor(
  element: BrowserCandidateElement,
  limit: number,
): readonly Omit<CandidateScoreInput, "matchCount" | "countError">[] {
  const role = bounded(element.role, 50) ?? implicitRole(element.tagName, null);
  const label = bounded(element.label, limit);
  const ariaLabel = bounded(element.ariaLabel, limit);
  const placeholder = bounded(element.placeholder, limit);
  const testId = bounded(element.testId, limit);
  const alt = bounded(element.alt, limit);
  const title = bounded(element.title, limit);
  const text = bounded(element.text, limit);
  const id = stableToken(bounded(element.stableId, 80));
  const className = stableToken(bounded(element.stableClass, 80));
  const accessibleName =
    ariaLabel ?? label ?? alt ?? title ?? text ?? placeholder;
  const values: Omit<CandidateScoreInput, "matchCount" | "countError">[] = [];
  if (role !== undefined && accessibleName !== undefined)
    values.push(
      descriptor(
        element,
        "role",
        { role, name: accessibleName },
        ariaLabel === undefined && label === undefined,
      ),
    );
  if (label !== undefined)
    values.push(descriptor(element, "label", { value: label }));
  if (placeholder !== undefined)
    values.push(descriptor(element, "placeholder", { value: placeholder }));
  if (testId !== undefined)
    values.push(descriptor(element, "test-id", { value: testId }));
  if (text !== undefined)
    values.push(descriptor(element, "text", { value: text }));
  if (alt !== undefined)
    values.push(descriptor(element, "alt-text", { value: alt }));
  if (title !== undefined)
    values.push(descriptor(element, "title", { value: title }));
  if (id !== undefined)
    values.push(descriptor(element, "stable-id", { value: id }));
  if (className !== undefined)
    values.push(
      descriptor(
        element,
        "scoped-css",
        { value: `${element.tagName}.${className}` },
        true,
      ),
    );
  return values;
}

export async function collectLocatorCandidates(
  page: Page,
  intent: LocatorTargetIntent,
  options: LocatorCandidateCollectionOptions = {},
): Promise<LocatorCandidateInventory> {
  const maximumCandidates = options.maximumCandidates ?? MAX_LOCATOR_CANDIDATES;
  const maximumCandidateTextLength = options.maximumCandidateTextLength ?? 120;
  if (
    !Number.isInteger(maximumCandidates) ||
    maximumCandidates < 1 ||
    maximumCandidates > MAX_LOCATOR_CANDIDATES
  )
    throw new Error(
      `maximumCandidates must be between 1 and ${String(MAX_LOCATOR_CANDIDATES)}.`,
    );
  if (
    !Number.isInteger(maximumCandidateTextLength) ||
    maximumCandidateTextLength < 20 ||
    maximumCandidateTextLength > 300
  )
    throw new Error("maximumCandidateTextLength must be between 20 and 300.");
  try {
    if (page.isClosed())
      throw new Error(
        "Candidate collection is unavailable because the page is closed.",
      );
    const maximumElements = Math.min(200, maximumCandidates * 3);
    const raw = await page.locator(COLLECTION_SELECTOR).evaluateAll(
      (unknownElements, settings): BrowserCollectionResult => {
        const elements = unknownElements as readonly BrowserElementLike[];
        const retained: BrowserCandidateElement[] = [];
        for (const element of elements.slice(0, settings.maximumElements)) {
          const tagName = (element.tagName ?? "unknown").toLowerCase();
          const type = element.getAttribute("type")?.toLowerCase() ?? null;
          if (type === "password") continue;
          const rectangle = element.getBoundingClientRect();
          const style = element.getAttribute("style") ?? "";
          const hidden =
            element.getAttribute("hidden") !== null ||
            element.getAttribute("aria-hidden") === "true" ||
            /display\s*:\s*none|visibility\s*:\s*hidden/iu.test(style);
          const visible =
            !hidden && rectangle.width > 0 && rectangle.height > 0;
          const enabled =
            element.disabled !== true &&
            element.getAttribute("aria-disabled") !== "true";
          const editable =
            (tagName === "input" ||
              tagName === "textarea" ||
              element.isContentEditable === true) &&
            element.readOnly !== true;
          if (!settings.includeHidden && !visible) continue;
          if (!settings.includeDisabled && !enabled) continue;
          const className =
            typeof element.className === "string"
              ? (element.className.split(/\s+/u).find(Boolean) ?? null)
              : null;
          retained.push({
            tagName,
            role: element.getAttribute("role"),
            ariaLabel: element.getAttribute("aria-label"),
            label: element.labels?.[0]?.textContent ?? null,
            placeholder: element.getAttribute("placeholder"),
            testId: element.getAttribute("data-testid"),
            alt: element.getAttribute("alt"),
            title: element.getAttribute("title"),
            stableId: element.getAttribute("id"),
            stableClass: className,
            text:
              tagName === "input" || tagName === "textarea"
                ? null
                : (element.textContent ?? null),
            visible,
            enabled,
            editable,
            hasBoundingBox: rectangle.width > 0 && rectangle.height > 0,
          });
        }
        return { elements: retained, matchedElementCount: elements.length };
      },
      {
        maximumElements,
        includeHidden: options.includeHiddenCandidates ?? false,
        includeDisabled: options.includeDisabledCandidates ?? true,
      },
    );
    const descriptorInputs = raw.elements.flatMap((element) =>
      descriptorsFor(element, maximumCandidateTextLength),
    );
    const counted: CandidateScoreInput[] = [];
    for (const candidate of descriptorInputs.slice(0, maximumCandidates * 3))
      counted.push(await withCount(page, candidate));
    const ranked = rankLocatorCandidates(counted, intent, maximumCandidates);
    return Object.freeze({
      status: "collected",
      candidates: ranked.candidates,
      droppedCandidateCount:
        ranked.dropped +
        Math.max(0, descriptorInputs.length - counted.length) +
        Math.max(0, raw.matchedElementCount - maximumElements),
      scannedElementCount: Math.min(raw.matchedElementCount, maximumElements),
      intent,
    });
  } catch (error) {
    return Object.freeze({
      status: "unavailable",
      candidates: Object.freeze([]),
      droppedCandidateCount: 0,
      scannedElementCount: 0,
      intent,
      error: redactSensitiveText(
        error instanceof Error
          ? error.message
          : "Candidate collection failed safely.",
        500,
      ),
    });
  }
}
