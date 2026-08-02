# Locator shadow observations and blind holdout review

A locator observation is a sanitized JSON record of what AegisAI saw when a locator-related test failed. It reuses the existing `locator-diagnosis.json` attachment: the attempted operation, bounded failure evidence, deterministic candidate inventory and scores, diagnosis, and safe provenance are enough for later review. Collection does not create another browser-diagnostics pipeline.

## Privacy boundary

An observation contains an anonymous application alias such as `app-001`, a controlled source type, bounded locator evidence and candidates, and a deterministic content-derived ID. It never contains an application host, full DOM or HTML, form or password values, cookies, headers, bodies, storage, environment values, absolute paths, binary evidence, or raw AI prompts and responses. Email addresses and secret-like values are removed during import; unsafe records are rejected.

The ID has the form `LOC-OBS-<16 hex characters>` and is derived from canonical sanitized content. Importing the same record produces the same ID and is treated as a duplicate. A private team may keep its own alias-to-application mapping outside this repository; company, customer, domain, user, and machine names should not be used as aliases.

## Review workflow

From the repository root:

```powershell
npm run ai:locator:observations:collect -- --input=examples/my-app/test-results --application=app-001
npm run ai:locator:observations:prepare-review
npm run ai:locator:observations:validate-reviews
npm run ai:locator:observations:validate-reviews -- --json
npm run ai:locator:holdout:evaluate
npm run ai:locator:holdout:evaluate -- --json
```

The steps are deliberately separate:

1. Run a consumer test and retain an applicable `locator-diagnosis.json` failure attachment.
2. Collect it into `artifacts/locator-observations/pending` as sanitized JSON.
3. Generate a template in `artifacts/locator-observations/review`.
4. A human changes its status to `reviewed` and supplies the expected classification, recommendation, acceptable/preferred/forbidden candidate IDs, minimum confidence, and rationale.
5. Validate reviews, then run the blind evaluator. Reports are written under `artifacts/locator-observations/reports`.

Use `--id=LOC-OBS-...` with `prepare-review` to prepare one observation. Completed review files are never overwritten. `rejected`, `pending`, and `needs-more-evidence` records do not enter scored holdout metrics.

## Actionable review validation

Human-readable validation prints the repository-relative review path, observation ID, and every independently detectable issue before the aggregate summary. Each issue contains:

- a stable code for users, tests, and future tooling;
- a category and JSON-style field path;
- a concise problem description;
- a bounded safe current value when useful;
- controlled allowed values for enums; and
- a specific repair suggestion.

Use `--json` for deterministic machine-readable output. JSON mode writes JSON only and exits non-zero when any review is invalid. Both modes retain the reviewed, pending, rejected, needs-more-evidence, invalid-file, and issue counts. Malformed JSON reports a safe syntax error and line/column when the runtime parser supplies a position.

The validator aggregates independent problems instead of stopping at the first one. It avoids dependent noise: for example, if `candidateIds` is not an array, membership checks that require a valid candidate array are skipped. Unknown properties remain invalid, and the validator never deletes, fills, migrates, or otherwise repairs a review automatically.

Common repairs include:

- `REVIEWED_CLASSIFICATION_REQUIRED`: choose the human-reviewed classification when a reviewed record still contains `null`.
- `REVIEW_PREFERRED_NOT_ACCEPTABLE`: add the candidate to `acceptableCandidateIds` or remove it from `preferredCandidateIds`.
- `REVIEW_ACCEPTABLE_FORBIDDEN_OVERLAP`: remove the candidate from one of the conflicting verdict arrays.
- `REVIEW_CANDIDATE_UNKNOWN`: regenerate the template or remove a candidate that is absent from `candidateIds` or the linked observation.
- `REVIEW_STATUS_UNSUPPORTED`, `REVIEW_CLASSIFICATION_UNSUPPORTED`, `REVIEW_RECOMMENDATION_STATUS_UNSUPPORTED`, and `REVIEW_CONFIDENCE_UNSUPPORTED`: select one of the exact allowed values printed by the command.
- `REVIEW_RATIONALE_EMPTY`: add the human explanation required for a reviewed verdict.
- `REVIEW_VERSION_UNSUPPORTED`: regenerate the review template with the current framework.

Stable diagnostic codes currently include `REVIEW_JSON_INVALID`, `REVIEW_FILE_READ_FAILED`, `REVIEW_OBSERVATION_NOT_FOUND`, `REVIEW_OBSERVATION_INVALID`, `REVIEW_FILENAME_ID_MISMATCH`, `REVIEW_REQUIRED_FIELD_MISSING`, `REVIEW_UNKNOWN_FIELD`, `REVIEW_FIELD_TYPE_INVALID`, `REVIEW_OBSERVATION_ID_INVALID`, `REVIEW_OBSERVATION_ID_MISMATCH`, `REVIEW_STATUS_UNSUPPORTED`, `REVIEW_VERSION_UNSUPPORTED`, `REVIEW_CANDIDATE_ID_INVALID`, `REVIEW_CANDIDATE_DUPLICATE`, `REVIEW_CANDIDATE_UNKNOWN`, `REVIEW_CANDIDATE_SET_MISMATCH`, `REVIEWED_CLASSIFICATION_REQUIRED`, `REVIEW_CLASSIFICATION_UNSUPPORTED`, `REVIEWED_RECOMMENDATION_STATUS_REQUIRED`, `REVIEW_RECOMMENDATION_STATUS_UNSUPPORTED`, `REVIEWED_CONFIDENCE_REQUIRED`, `REVIEW_CONFIDENCE_UNSUPPORTED`, `REVIEW_PREFERRED_NOT_ACCEPTABLE`, `REVIEW_ACCEPTABLE_FORBIDDEN_OVERLAP`, `REVIEW_PREFERRED_FORBIDDEN_OVERLAP`, `REVIEWED_ACCEPTABLE_CANDIDATE_REQUIRED`, `REVIEW_RATIONALE_EMPTY`, `REVIEW_RATIONALE_TOO_SHORT`, `REVIEW_RATIONALE_TOO_LONG`, and `REVIEW_TEXT_UNSAFE`.

The human reviewer remains responsible for the verdict. Review files and observations stay under ignored `artifacts/locator-observations` paths and must not be committed.

## Blindness and metrics

The analyser receives only the observation's failure evidence, page state, target intent, and candidate inventory. Expected answers, rationale, forbidden candidates, and thresholds remain in the separate review record. They are loaded for comparison only after diagnosis completes. The holdout report reuses the established classification, recommendation, ranking, confidence, and safety metrics without combining them with the controlled benchmark.

Zero eligible cases display N/A rather than 100%. Synthetic fixtures prove the workflow, not real-world accuracy. A minimum of 30 independently reviewed real-shadow observations spanning different failure classes and application states is recommended before considering even an isolated locator-replay experiment. More observations and application diversity are preferable.

The evaluator never applies a locator, retries an action, edits a test, or marks a failure as healed. Deterministic-only mode is the default; optional `--mode=mock-ai` remains offline. Self-healing is still absent.
