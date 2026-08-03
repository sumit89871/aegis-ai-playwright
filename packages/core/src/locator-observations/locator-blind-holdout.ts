import type { LocatorEvaluationMode } from "../locator-evaluation/evaluation-runner.ts";
import type { LocatorObservation } from "./locator-observation.ts";
import type { LocatorObservationReview } from "./locator-observation-review.ts";
import {
  translateLocatorBlindReview,
  validateLocatorBlindCandidateMapping,
  validateLocatorBlindReview,
  validateLocatorBlindReviewPacket,
  type LocatorBlindCandidateMapping,
  type LocatorBlindReview,
  type LocatorBlindReviewPacket,
} from "./locator-blind-review.ts";
import {
  runLocatorHoldoutEvaluation,
  type LocatorHoldoutResult,
} from "./locator-holdout-runner.ts";

export interface LocatorBlindHoldoutRecord {
  readonly observation: LocatorObservation;
  readonly packet: LocatorBlindReviewPacket;
  readonly mapping: LocatorBlindCandidateMapping;
  readonly review: LocatorBlindReview;
}

export interface LocatorBlindHoldoutResult {
  readonly schemaVersion: "1.0.0";
  readonly mode: LocatorEvaluationMode;
  readonly status: LocatorHoldoutResult["status"];
  readonly meaningful: boolean;
  readonly counts: {
    readonly calibrationPilotReviewed: number;
    readonly blindHoldoutReviewed: number;
    readonly pendingBlindReviews: number;
    readonly invalidBlindReviews: number;
    readonly ineligibleReviews: number;
  };
  readonly holdout: LocatorHoldoutResult;
  readonly notice: string;
  readonly safety: {
    readonly networkCalls: 0;
    readonly locatorApplications: 0;
    readonly automaticHealing: false;
  };
}

export async function runLocatorBlindHoldoutEvaluation(
  records: readonly LocatorBlindHoldoutRecord[],
  options: {
    readonly mode?: "deterministic-only" | "mock-ai";
    readonly calibrationPilotReviewed?: number;
    readonly invalidBlindReviews?: number;
  } = {},
): Promise<LocatorBlindHoldoutResult> {
  const reviewed: LocatorObservationReview[] = [];
  const observations: LocatorObservation[] = [];
  let pending = 0;
  let ineligible = 0;
  for (const record of [...records].sort((left, right) =>
    left.packet.blindPacketId.localeCompare(right.packet.blindPacketId),
  )) {
    const packet = validateLocatorBlindReviewPacket(
      record.packet,
      record.observation,
    );
    validateLocatorBlindCandidateMapping(
      record.mapping,
      packet,
      record.observation,
    );
    const review = validateLocatorBlindReview(record.review, packet);
    if (review.reviewStatus === "pending") {
      pending += 1;
      continue;
    }
    if (review.reviewStatus !== "reviewed") {
      ineligible += 1;
      continue;
    }
    observations.push(record.observation);
    reviewed.push(
      translateLocatorBlindReview(
        record.observation,
        packet,
        record.mapping,
        review,
      ),
    );
  }
  const holdout = await runLocatorHoldoutEvaluation(
    observations,
    reviewed,
    options.mode === undefined ? {} : { mode: options.mode },
  );
  const blindCount = reviewed.length;
  const notice =
    blindCount === 0
      ? "Zero eligible blind holdout reviews are available. Pilot/calibration reviews are reported separately and are not accuracy evidence."
      : `${String(blindCount)} blind holdout review(s) were evaluated independently. Sample size alone never authorizes locator replay or automatic healing.`;
  return Object.freeze({
    schemaVersion: "1.0.0",
    mode: options.mode ?? "deterministic-only",
    status: holdout.status,
    meaningful: holdout.meaningful,
    counts: Object.freeze({
      calibrationPilotReviewed: options.calibrationPilotReviewed ?? 0,
      blindHoldoutReviewed: blindCount,
      pendingBlindReviews: pending,
      invalidBlindReviews: options.invalidBlindReviews ?? 0,
      ineligibleReviews: ineligible,
    }),
    holdout,
    notice,
    safety: Object.freeze({
      networkCalls: 0,
      locatorApplications: 0,
      automaticHealing: false,
    }),
  });
}

export function renderLocatorBlindHoldoutMarkdown(
  result: LocatorBlindHoldoutResult,
): string {
  const lines = [
    "# Blind locator holdout evaluation",
    "",
    `- Status: ${result.status}`,
    `- Meaningful sample: ${result.meaningful ? "yes" : "no"}`,
    `- Pilot/calibration reviewed: ${String(result.counts.calibrationPilotReviewed)}`,
    `- Blind holdout reviewed: ${String(result.counts.blindHoldoutReviewed)}`,
    `- Pending blind reviews: ${String(result.counts.pendingBlindReviews)}`,
    `- Invalid blind reviews: ${String(result.counts.invalidBlindReviews)}`,
    `- Ineligible reviews: ${String(result.counts.ineligibleReviews)}`,
    `- Notice: ${result.notice.replace(/[<>]/gu, "").slice(0, 500)}`,
    "",
    "## Isolation",
    "",
    "- Expected answers are loaded only after deterministic diagnosis input is built.",
    "- Neutral aliases are translated through a validated private mapping after review.",
    "- Network calls: 0",
    "- Locator applications: 0",
    "- Automatic healing: absent",
  ];
  return lines.join("\n");
}
