# Locator-diagnosis evaluation

The locator evaluator measures whether advisory diagnosis gives safe, useful answers before those suggestions can influence any testing workflow. It never applies a locator, retries an action, edits a test, or marks a failure as passed.

## Reviewed benchmark packs

The repository contains two versioned packs with 20 cases each:

- **Calibration** exposes weaknesses that may justify small deterministic scoring or classification adjustments.
- **Validation** checks that an adjustment generalizes to separate reviewed examples.

The 40 cases cover genuine selector changes, strict-mode ambiguity, label/test-ID/text/role/alt candidates, hidden and disabled state, overlays, instability, readiness and lifecycle failures, application/network/accessibility assertions, unavailable collection, empty inventories, and ambiguous equal candidates. Each case stores its input separately from a human-reviewed expected answer and rationale. Expected fields are stripped before diagnosis.

Both packs are visible in the repository. They are useful regression benchmarks, not an independent blind study and not proof of production accuracy.

## Metrics

- **Classification accuracy** is the share of cases assigned the exact reviewed failure class.
- **Recommendation accuracy** checks whether the result correctly recommends candidates, no change, abstention, unavailable collection, or not applicable.
- **No-change precision** asks how often a no-change recommendation is correct. **Recall** asks how many reviewed no-change cases were found.
- **Top-1 and top-3 acceptable rates** measure whether an approved candidate appears first or among the first three suggestions.
- **Unsafe recommendation rate** counts any forbidden candidate, invented ID, XPath, positional repair, force recommendation, patch, command, or locator-change recommendation in a reviewed no-change case.

Zero eligible cases are reported as `N/A`, never as a misleading 100%.

## Thresholds and calibration

Safety thresholds are zero tolerance. Quality requires at least 90% classification accuracy, 95% recommendation accuracy, 100% no-change precision, 95% no-change recall, 70% top-1 acceptable candidates, 90% top-3 acceptable candidates, and zero high-confidence incorrect decisions.

The pre-calibration run found three specific mismatches:

- `LOC-EVAL-CAL-019` overpromoted two equally scored candidates.
- `LOC-EVAL-VAL-014` did not recognize the common "timeout while waiting" no-match wording.
- `LOC-EVAL-VAL-019` overpromoted several equally scored candidates.

Only two narrow changes followed: recognition of "while waiting" and deterministic abstention when the two strongest scores tie. Strategy weights and every security/no-change rule were unchanged. After calibration, both packs reached 100% classification and recommendation accuracy, 100% top-1/top-3 acceptable rates, and zero unsafe recommendations. One validation case (`LOC-EVAL-VAL-004`) remains listed for human review because its safe alt-text result has medium confidence while the reviewed minimum is high; this does not miss a required quality or safety threshold. These controlled results still require production shadow-mode evidence.

## Commands

```powershell
npm run ai:locator:evaluate
npm run ai:locator:evaluate -- --json
npm run ai:locator:evaluate -- --dataset=validation
npm run ai:locator:evaluate -- --mode=mock-ai
npm run doctor
npm run validate
```

The default is deterministic-only, uses no key, and makes no network request. JSON and Markdown reports are written beneath `artifacts/locator-evaluation` and ignored by Git. Mock mode compares a deterministic mock ranking with the fixed analysis; it does not represent a real model.

An optional future command, `npm run ai:locator:evaluate:openrouter -- --confirm-network`, is guarded by explicit network, key, model, pricing, timeout, token, cost, and case-count limits. It is never run by CI or normal validation and was not executed for this milestone.

## Browser-backed pack

The existing Chromium, Firefox, and WebKit matrix also runs eight local data-page cases. They cover no-match, duplicate text, disabled and obstructed controls, label and test-ID alternatives, hidden state, and an empty inventory. No external application, network asset, form value, or full HTML is retained.

Automatic healing remains absent. The next safe step is additional human-reviewed shadow-mode evidence from diverse applications, not automatic locator replacement.

## Pilot reviews and independent blind holdout

The committed calibration and validation packs remain controlled and repository-visible. Legacy observation reviews also expose Aegis's answer and are labelled pilot/calibration evidence. Neither may be combined with independent blind holdout percentages.

The blind workflow hides the actual diagnosis, scores, ranked order, and original candidate IDs before human review. Its evaluator reconnects neutral aliases only after review completion and reports pilot and blind counts separately. With zero blind reviews it reports N/A and an insufficient-sample warning, not 100% accuracy. See [Locator shadow observations](locator-shadow-observations.md).
