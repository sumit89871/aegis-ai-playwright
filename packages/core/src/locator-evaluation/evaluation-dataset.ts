import type { CandidateScoreInput } from "../locator-diagnosis/locator-candidate.ts";
import type {
  LocatorDiagnosisConfidence,
  LocatorRecommendationStatus,
} from "../locator-diagnosis/locator-diagnosis.ts";
import type { LocatorFailureClassification } from "../locator-diagnosis/locator-failure-classifier.ts";
import { inferLocatorTargetIntent } from "../locator-diagnosis/locator-failure-classifier.ts";
import type {
  LocatorEvaluationCase,
  LocatorEvaluationCategory,
  LocatorEvaluationSourceType,
  ReviewedLocatorCandidate,
} from "./evaluation-case.ts";
import { validateLocatorEvaluationDataset } from "./evaluation-validator.ts";

const CALIBRATION_VERSION = "1.0.0";
const VALIDATION_VERSION = "1.0.0";

function candidate(
  candidateId: string,
  strategy: CandidateScoreInput["strategy"],
  value: string,
  overrides: Partial<CandidateScoreInput> = {},
): ReviewedLocatorCandidate {
  return Object.freeze({
    candidateId,
    descriptor: Object.freeze({
      strategy,
      ...(strategy === "role"
        ? { role: overrides.role ?? "button", name: value }
        : { value }),
      exact: true,
      scopeHint: null,
      tagName:
        strategy === "label" || strategy === "placeholder" ? "input" : "button",
      matchCount: 1,
      visible: true,
      enabled: true,
      editable: strategy === "label" || strategy === "placeholder",
      hasBoundingBox: true,
      ...overrides,
    }),
  });
}

interface CaseOptions {
  readonly pack: "CAL" | "VAL";
  readonly number: number;
  readonly title: string;
  readonly category: LocatorEvaluationCategory;
  readonly message: string;
  readonly expectedClassification: LocatorFailureClassification;
  readonly expectedRecommendation: LocatorRecommendationStatus;
  readonly candidates?: readonly ReviewedLocatorCandidate[];
  readonly acceptable?: readonly string[];
  readonly preferred?: readonly string[];
  readonly forbidden?: readonly string[];
  readonly locatorChangeAllowed?: boolean;
  readonly minimumConfidence?: LocatorDiagnosisConfidence;
  readonly pageReady?: boolean | null;
  readonly pageAvailable?: boolean;
  readonly collectionStatus?: "collected" | "unavailable" | "not-requested";
  readonly collectionError?: string;
  readonly originalLocatorDescription?: string;
  readonly sourceType?: LocatorEvaluationSourceType;
  readonly rationale: string;
  readonly uncertainty?: string;
  readonly tags?: readonly string[];
}

function reviewedCase(options: CaseOptions): LocatorEvaluationCase {
  const version =
    options.pack === "CAL" ? CALIBRATION_VERSION : VALIDATION_VERSION;
  const intent = inferLocatorTargetIntent(options.message);
  const locatorChangeAllowed = options.locatorChangeAllowed ?? false;
  const acceptable = options.acceptable ?? [];
  const preferred = options.preferred ?? [];
  const forbidden = options.forbidden ?? [];
  return Object.freeze({
    caseId: `LOC-EVAL-${options.pack}-${String(options.number).padStart(3, "0")}`,
    title: options.title,
    description: `Reviewed ${options.category} example: ${options.title}.`,
    category: options.category,
    sourceType: options.sourceType ?? "synthetic",
    input: Object.freeze({
      failure: Object.freeze({
        errorMessage: options.message,
        pageReady: options.pageReady ?? true,
        pageAvailable: options.pageAvailable ?? true,
      }),
      pageReadinessState: options.pageReady ?? true,
      attemptedOperation: intent.operation,
      ...(options.originalLocatorDescription === undefined
        ? {}
        : { originalLocatorDescription: options.originalLocatorDescription }),
      targetIntent: intent,
      candidateCollectionStatus: options.collectionStatus ?? "collected",
      ...(options.collectionError === undefined
        ? {}
        : { candidateCollectionError: options.collectionError }),
      candidates: Object.freeze(options.candidates ?? []),
    }),
    expected: Object.freeze({
      classification: options.expectedClassification,
      recommendationStatus: options.expectedRecommendation,
      acceptableCandidateIds: Object.freeze(acceptable),
      preferredCandidateIds: Object.freeze(preferred),
      forbiddenCandidateIds: Object.freeze(forbidden),
      locatorChangeAllowed,
      minimumConfidence: options.minimumConfidence ?? "high",
    }),
    humanReview: Object.freeze({
      classificationReason: options.rationale,
      locatorChangeReason: locatorChangeAllowed
        ? "The original locator no longer identifies the intended element, so human review of bounded alternatives is appropriate."
        : "The reviewed evidence does not justify changing a locator.",
      candidateReason:
        acceptable.length > 0
          ? `Acceptable candidates are ${acceptable.join(", ")}; preferred candidates are ${preferred.join(", ")}. Forbidden candidates are ${forbidden.join(", ") || "none"}.`
          : `No replacement is approved. Forbidden candidates are ${forbidden.join(", ") || "none"}.`,
      uncertainty:
        options.uncertainty ??
        "The case is controlled and cannot represent every production page state.",
    }),
    tags: Object.freeze(options.tags ?? [options.category]),
    datasetVersion: version,
  });
}

const calibrationCases: readonly LocatorEvaluationCase[] = [
  reviewedCase({
    pack: "CAL",
    number: 1,
    title: "CSS selector no longer matches",
    category: "locator-change",
    message: "click locator('.legacy-save') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Save changes"),
      candidate("LOCATOR-002", "test-id", "save-button"),
      candidate("LOCATOR-003", "text", "Save", { matchCount: 2 }),
    ],
    acceptable: ["LOCATOR-001", "LOCATOR-002"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-003"],
    locatorChangeAllowed: true,
    rationale:
      "A removed CSS selector is a genuine no-match and the unique semantic candidates describe the intended save action.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 2,
    title: "Accessible name changed",
    category: "locator-change",
    message:
      "click getByRole('button', { name: 'Submit order' }) resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Place order"),
      candidate("LOCATOR-002", "test-id", "place-order"),
    ],
    acceptable: ["LOCATOR-001", "LOCATOR-002"],
    preferred: ["LOCATOR-001"],
    locatorChangeAllowed: true,
    rationale:
      "The old accessible name has no match while a unique renamed action and stable test ID are available.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 3,
    title: "Form label changed",
    category: "locator-change",
    message: "fill getByLabel('Work email') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "label", "Business email"),
      candidate("LOCATOR-002", "placeholder", "name@example.test"),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "The missing label is a locator change and the new associated label is the strongest fill target.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 4,
    title: "Test ID changed",
    category: "locator-change",
    message: "click getByTestId('old-submit') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Submit"),
      candidate("LOCATOR-002", "test-id", "submit-form"),
    ],
    acceptable: ["LOCATOR-001", "LOCATOR-002"],
    preferred: ["LOCATOR-001"],
    locatorChangeAllowed: true,
    rationale:
      "The old test ID is absent and both retained unique candidates are reviewable, with the semantic role preferred.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 5,
    title: "CSS class changed",
    category: "locator-change",
    message: "click locator('.generated_old_42') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Continue"),
      candidate("LOCATOR-002", "scoped-css", "button.continue-action"),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "The implementation class disappeared and the unique user-facing role is safer than another CSS implementation detail.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 6,
    title: "Strict text ambiguity",
    category: "locator-change",
    message:
      "click getByText('Save') strict mode violation: resolved to 2 elements",
    expectedClassification: "strict-mode-violation",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Save profile"),
      candidate("LOCATOR-002", "text", "Save", { matchCount: 2 }),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "Strict mode proves ambiguity and the unique named button removes it without a positional repair.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 7,
    title: "Multiple matching links",
    category: "locator-change",
    message: "click getByText('Details') resolved to multiple elements",
    expectedClassification: "selector-multiple-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Account details", { role: "link" }),
      candidate("LOCATOR-002", "text", "Details", {
        tagName: "a",
        matchCount: 3,
      }),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "The text locator is ambiguous and the uniquely named link is an acceptable semantic replacement.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 8,
    title: "Duplicate buttons with unique name",
    category: "locator-change",
    message: "click locator('button') resolved to multiple elements",
    expectedClassification: "selector-multiple-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Approve request"),
      candidate("LOCATOR-002", "scoped-css", "button", { matchCount: 4 }),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "A broad button selector is ambiguous while the accessible name uniquely identifies the reviewed action.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 9,
    title: "Weak text versus role",
    category: "locator-change",
    message: "click getByText('Open') resolved to multiple elements",
    expectedClassification: "selector-multiple-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Open settings"),
      candidate("LOCATOR-002", "text", "Open", { matchCount: 3 }),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "Generic text is duplicated and the exact semantic button is the reviewed target.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 10,
    title: "Generated class with semantic alternative",
    category: "locator-change",
    message: "click locator('.css-1a2b3c') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Add item"),
      candidate("LOCATOR-002", "test-id", "add-item"),
    ],
    acceptable: ["LOCATOR-001", "LOCATOR-002"],
    preferred: ["LOCATOR-001"],
    locatorChangeAllowed: true,
    rationale:
      "The generated class is absent; both stable alternatives are reviewable and the accessible role is preferred.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 11,
    title: "Correct button disabled",
    category: "no-change",
    message:
      "click getByRole('button', { name: 'Continue' }) element is not enabled",
    expectedClassification: "element-not-enabled",
    expectedRecommendation: "no-change-recommended",
    candidates: [
      candidate("LOCATOR-001", "test-id", "continue", { enabled: false }),
    ],
    forbidden: ["LOCATOR-001"],
    rationale:
      "The intended element resolves but application state disables it, so replacing the locator would be misleading.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 12,
    title: "Correct element hidden",
    category: "no-change",
    message:
      "click getByRole('button', { name: 'Continue' }) element is not visible",
    expectedClassification: "element-not-visible",
    expectedRecommendation: "no-change-recommended",
    candidates: [
      candidate("LOCATOR-001", "test-id", "continue", { visible: false }),
    ],
    forbidden: ["LOCATOR-001"],
    rationale: "Visibility state, not selector identity, caused the failure.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 13,
    title: "Overlay intercepts click",
    category: "no-change",
    message:
      "click getByRole('button', { name: 'Save' }) another element would receive the click",
    expectedClassification: "action-obstructed",
    expectedRecommendation: "no-change-recommended",
    rationale:
      "The correct element is obstructed by application state; forcing or replacing it is unsafe.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 14,
    title: "Element remains unstable",
    category: "no-change",
    message:
      "click getByRole('button', { name: 'Save' }) element is not stable",
    expectedClassification: "element-not-stable",
    expectedRecommendation: "no-change-recommended",
    rationale:
      "Animation or rerender stability must be investigated before any locator change.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 15,
    title: "Business readiness failed",
    category: "no-change",
    message: "Page readiness failed for account-page: heading unavailable",
    expectedClassification: "page-not-ready",
    expectedRecommendation: "no-change-recommended",
    pageReady: false,
    rationale:
      "The page contract failed before locator use, so locator replacement is not justified.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 16,
    title: "HTTP 500 prevents page state",
    category: "non-locator",
    message: "HTTP 500 response prevented the expected page content",
    expectedClassification: "not-a-locator-failure",
    expectedRecommendation: "not-applicable",
    rationale:
      "The server failure is application evidence, not a locator defect.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 17,
    title: "Accessibility assertion failure",
    category: "non-locator",
    message: "Accessibility color-contrast violation remained serious",
    expectedClassification: "not-a-locator-failure",
    expectedRecommendation: "not-applicable",
    rationale:
      "The accessibility policy failure requires a UI contrast fix, not a locator replacement.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 18,
    title: "Page unavailable during collection",
    category: "insufficient-evidence",
    message: "click locator('.missing') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "collection-unavailable",
    pageAvailable: false,
    collectionStatus: "unavailable",
    collectionError: "The page was unavailable for safe collection.",
    minimumConfidence: "low",
    rationale:
      "The no-match is known but teardown cannot safely inspect candidates.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 19,
    title: "Equally strong semantic candidates",
    category: "insufficient-evidence",
    message: "click locator('.old-action') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "insufficient-evidence",
    candidates: [
      candidate("LOCATOR-001", "role", "Approve"),
      candidate("LOCATOR-002", "role", "Reject"),
    ],
    minimumConfidence: "low",
    rationale:
      "Two equally strong but semantically different buttons exist and target meaning cannot select between them.",
    uncertainty:
      "A human must supply business intent or a meaningful scope before choosing.",
  }),
  reviewedCase({
    pack: "CAL",
    number: 20,
    title: "Empty safe candidate inventory",
    category: "insufficient-evidence",
    message: "click locator('.removed') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "insufficient-evidence",
    candidates: [],
    minimumConfidence: "low",
    rationale:
      "The selector failed and collection found no bounded safe alternative.",
  }),
];

const validationCases: readonly LocatorEvaluationCase[] = [
  reviewedCase({
    pack: "VAL",
    number: 1,
    title: "Dynamic ID with stable role",
    category: "locator-change",
    message: "click locator('#action-982374') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Publish"),
      candidate("LOCATOR-002", "stable-id", "action-982375"),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "The numeric ID changed and the unique semantic action is the stable reviewed alternative.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 2,
    title: "Meaningful scope resolves duplicate",
    category: "locator-change",
    message: "click getByText('Edit') resolved to multiple elements",
    expectedClassification: "selector-multiple-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "Edit billing address", {
        scopeHint: "Billing address",
      }),
      candidate("LOCATOR-002", "text", "Edit", { matchCount: 4 }),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "The scoped accessible name identifies the reviewed action without choosing a position.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 3,
    title: "Fill uses unique label",
    category: "locator-change",
    message: "fill locator('.email-field') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "label", "Email address"),
      candidate("LOCATOR-002", "text", "Email address", { tagName: "span" }),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "The unique associated label targets an editable control; visible text alone does not.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 4,
    title: "Image uses alt text",
    category: "locator-change",
    message: "click locator('img.old-logo') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "alt-text", "Company home", { tagName: "img" }),
      candidate("LOCATOR-002", "title", "Logo", {
        tagName: "img",
        matchCount: 2,
      }),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "The unique meaningful alternative text is a stronger reviewed image locator than duplicate title text.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 5,
    title: "Page closed before action",
    category: "no-change",
    message:
      "click getByRole('button', { name: 'Save' }): target page, context or browser has been closed",
    expectedClassification: "page-closed",
    expectedRecommendation: "no-change-recommended",
    pageAvailable: false,
    rationale:
      "The page lifecycle ended; no selector can repair a closed page.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 6,
    title: "Browser context closed",
    category: "no-change",
    message: "browser context closed while waiting for locator('button')",
    expectedClassification: "page-closed",
    expectedRecommendation: "no-change-recommended",
    pageAvailable: false,
    rationale:
      "The browser context ended, which is an environment or lifecycle problem.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 7,
    title: "Failed request prevents content",
    category: "non-locator",
    message: "Request failed while loading the application content",
    expectedClassification: "not-a-locator-failure",
    expectedRecommendation: "not-applicable",
    rationale:
      "Network evidence explains missing content without proving a selector defect.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 8,
    title: "Business value assertion",
    category: "non-locator",
    message: "Expected value 42 but received: 41",
    expectedClassification: "not-a-locator-failure",
    expectedRecommendation: "not-applicable",
    rationale:
      "The assertion compares business values and has no locator evidence.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 9,
    title: "Correct locator has wrong text",
    category: "non-locator",
    message:
      "expect(locator).toHaveText expected value Active but received: Pending",
    expectedClassification: "not-a-locator-failure",
    expectedRecommendation: "not-applicable",
    rationale:
      "The locator resolved and exposed a business-state mismatch rather than a selector failure.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 10,
    title: "Fill targets non-editable control",
    category: "no-change",
    message: "fill getByLabel('Account status') element is not editable",
    expectedClassification: "element-not-editable",
    expectedRecommendation: "no-change-recommended",
    rationale:
      "The target resolves but does not support the attempted operation.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 11,
    title: "Rerender detaches element",
    category: "no-change",
    message:
      "click getByRole('button', { name: 'Refresh' }) element was detached from the DOM",
    expectedClassification: "element-detached",
    expectedRecommendation: "no-change-recommended",
    rationale:
      "Application rerender timing caused detachment; a new locator is not yet justified.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 12,
    title: "Candidate collection times out",
    category: "insufficient-evidence",
    message: "click locator('.missing-action') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "collection-unavailable",
    collectionStatus: "unavailable",
    collectionError: "Candidate collection exceeded its bounded duration.",
    minimumConfidence: "low",
    rationale:
      "The selector failed but the bounded inventory could not be obtained.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 13,
    title: "Original locator description unavailable",
    category: "insufficient-evidence",
    message: "An unusual locator transport condition occurred",
    expectedClassification: "unknown-locator-failure",
    expectedRecommendation: "insufficient-evidence",
    collectionStatus: "not-requested",
    minimumConfidence: "low",
    rationale:
      "Locator context exists, but the original strategy and controlled failure cause are unknown.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 14,
    title: "Target intent cannot be inferred",
    category: "insufficient-evidence",
    message: "click locator failed with timeout while waiting",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "insufficient-evidence",
    candidates: [
      candidate("LOCATOR-001", "role", "Enable"),
      candidate("LOCATOR-002", "role", "Disable"),
    ],
    minimumConfidence: "low",
    rationale:
      "Candidate semantics are known but the failed target meaning is unavailable, so neither can be approved.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 15,
    title: "Removed selector with unique test ID",
    category: "locator-change",
    message: "click locator('.old-download') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "test-id", "download-report"),
      candidate("LOCATOR-002", "text", "Download", { matchCount: 2 }),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "The unique stable test ID is acceptable and duplicate text is not.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 16,
    title: "Strict duplicate link text",
    category: "locator-change",
    message:
      "click getByText('View') strict mode violation: resolved to 3 elements",
    expectedClassification: "strict-mode-violation",
    expectedRecommendation: "candidates-available",
    candidates: [
      candidate("LOCATOR-001", "role", "View invoice", { role: "link" }),
      candidate("LOCATOR-002", "text", "View", { tagName: "a", matchCount: 3 }),
    ],
    acceptable: ["LOCATOR-001"],
    preferred: ["LOCATOR-001"],
    forbidden: ["LOCATOR-002"],
    locatorChangeAllowed: true,
    rationale:
      "The uniquely named link resolves the reviewed ambiguity without a positional selection.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 17,
    title: "Hidden dialog action",
    category: "no-change",
    message:
      "click getByRole('button', { name: 'Confirm' }) hidden element is not visible",
    expectedClassification: "element-not-visible",
    expectedRecommendation: "no-change-recommended",
    rationale:
      "The dialog state must be opened correctly before the existing semantic locator can act.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 18,
    title: "Animation overlay obstruction",
    category: "no-change",
    message:
      "click getByRole('button', { name: 'Next' }) overlay intercepts pointer events",
    expectedClassification: "action-obstructed",
    expectedRecommendation: "no-change-recommended",
    rationale:
      "The correct target is obstructed; forcing or replacing it would hide an application-state problem.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 19,
    title: "Several equal semantic candidates",
    category: "insufficient-evidence",
    message: "click locator('.removed-control') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "insufficient-evidence",
    candidates: [
      candidate("LOCATOR-001", "role", "Start"),
      candidate("LOCATOR-002", "role", "Stop"),
      candidate("LOCATOR-003", "role", "Pause"),
    ],
    minimumConfidence: "low",
    rationale:
      "Three equally strong actions exist and the original CSS provides no business meaning.",
  }),
  reviewedCase({
    pack: "VAL",
    number: 20,
    title: "No retained candidate",
    category: "insufficient-evidence",
    message: "click getByTestId('removed-control') resolved to no elements",
    expectedClassification: "selector-no-match",
    expectedRecommendation: "insufficient-evidence",
    candidates: [],
    minimumConfidence: "low",
    rationale:
      "The removed test ID has no bounded replacement candidate in the reviewed page state.",
  }),
];

export const LOCATOR_CALIBRATION_DATASET = validateLocatorEvaluationDataset({
  id: "calibration",
  version: CALIBRATION_VERSION,
  description:
    "Repository-visible reviewed calibration cases for deterministic locator diagnosis.",
  cases: calibrationCases,
});

export const LOCATOR_VALIDATION_DATASET = validateLocatorEvaluationDataset({
  id: "validation",
  version: VALIDATION_VERSION,
  description:
    "Repository-visible reviewed validation cases kept separate from calibration cases.",
  cases: validationCases,
});

export const LOCATOR_EVALUATION_DATASETS = Object.freeze([
  LOCATOR_CALIBRATION_DATASET,
  LOCATOR_VALIDATION_DATASET,
]);
