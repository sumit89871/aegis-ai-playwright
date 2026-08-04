# Locator shadow observations and blind review

A locator observation is a sanitized JSON record of what AegisAI saw when a locator-related test failed. It reuses `locator-diagnosis.json`; collection does not create a second diagnostics pipeline. Observations contain the deterministic diagnosis and score-ranked candidates, so opening one before deciding the expected answer can bias a reviewer.

The five original reviewed observations are valuable pilot and calibration cases: they prove collection, review validation, alias-free evaluation, and reporting work. They are not unbiased holdout evidence because the reviewer could see Aegis's classification, recommendation, confidence, scores, ranking, and `LOCATOR-001`-style IDs. Those IDs are assigned after scoring and can reveal rank even if scores are hidden.

## Privacy boundary

An observation uses an anonymous application alias and deterministic content-derived ID. It never retains an application host, full DOM or HTML, form or password values, cookies, headers, bodies, storage, environment values, absolute paths, binary evidence, or raw AI prompts and responses. Local artifacts remain under ignored `artifacts/locator-observations` paths.

A blind packet adds a second allowlist boundary. It contains only sanitized failure and page-readiness evidence, conservative target intent, and candidate facts needed for a human decision. It excludes Aegis's classification, recommendation, confidence, summary, ranks, next step, scores, stability, scoring rationale, analysis provenance, AI output, and original candidate IDs.

## Blind candidate aliases

The packet uses `BLIND-CANDIDATE-001` aliases. Candidates are ordered using a deterministic content hash; if that happens to preserve source ranking, the order is rotated. Consequently, alias numbering is reproducible for the same observation but does not preserve Aegis's rank. Zero- and one-candidate packets are supported.

The original-to-blind mapping is stored separately under the ignored `blind/mappings` directory. It links the source observation and packet with SHA-256 integrity digests and must match both candidate inventories one-to-one. The reviewer should not inspect this internal mapping. This is workflow isolation against accidental leakage, not cryptographic secrecy from someone who deliberately opens internal files.

## Recommended blind workflow

```powershell
npm run ai:locator:observations:collect -- --input=examples/my-app/test-results --application=app-001
npm run ai:locator:observations:prepare-blind-review -- --id=LOC-OBS-...
npm run ai:locator:observations:validate-blind-reviews
npm run ai:locator:observations:validate-blind-reviews -- --json
npm run ai:locator:holdout:evaluate:blind
npm run ai:locator:holdout:evaluate:blind -- --summary-json
```

The flow is:

```text
Real failure
→ sanitized observation
→ blind packet
→ independent human review
→ validation
→ private alias remapping
→ holdout comparison
```

The preparation command creates three ignored files without overwriting any existing file:

- `blind/packets/<packet-id>.blind-packet.json`: the only evidence packet the reviewer should open;
- `blind/mappings/<packet-id>.blind-mapping.json`: internal mapping the reviewer should not inspect; and
- `blind/reviews/<packet-id>.blind-review.json`: the blank human verdict template.

The review starts as `pending`. The human supplies the supported classification, recommendation status, acceptable/preferred/forbidden blind aliases, minimum confidence, and rationale. No command fills those answers automatically.

Candidate inventories and every candidate-verdict array share the framework maximum of 50 entries. A review may therefore retain a large, valid negative-label set, including all 50 candidates when that reflects the human decision. Candidates do not have to appear in acceptable, preferred, or forbidden arrays: those arrays record reviewed judgments, not an exhaustive labelling requirement. Arrays above the shared maximum fail with an actionable validation issue and are never silently truncated or repaired.

## Validation and eligibility

Blind validation is strict and actionable. It checks schema and review versions, filenames, packet and observation IDs, integrity digests, exact candidate inventory, alias uniqueness, mapping targets, supported enums, rationale rules, unknown fields, and candidate relationships. It aggregates independent issues, supports JSON-only output, prints repository-relative paths, and never repairs a file.

A review counts as blind holdout evidence only when its packet, private mapping, source observation, and completed review all validate; integrity links match; aliases map to existing original candidates; and no relationship rule is broken. `pending` is reported separately. `rejected` and `needs-more-evidence` are ineligible for scoring. Invalid artifacts are counted and excluded.

The blind evaluator loads the observation, validates the packet and mapping, builds deterministic analyser input without human expected answers, then maps the reviewed aliases back to original IDs for comparison. Its report keeps these counts separate:

- pilot/calibration reviewed;
- blind holdout reviewed;
- pending blind reviews;
- invalid blind reviews; and
- ineligible reviews.

The legacy commands remain available and unchanged for pilot/calibration work:

```powershell
npm run ai:locator:observations:prepare-review
npm run ai:locator:observations:validate-reviews
npm run ai:locator:holdout:evaluate
```

Their results must not be described as unbiased blind accuracy.

## Privacy-safe blind metrics

Eligible counts show that review isolation worked, but they do not measure whether Aegis agreed with the independent reviewer. The normal blind command therefore displays aggregate classification, recommendation, ranking, safety, confidence, and abstention metrics even when the status remains `INSUFFICIENT-SAMPLE`. The warning remains prominent because a small sample is directional evidence, not a production-accuracy estimate.

Use `--summary-json` for a machine-readable allowlisted aggregate. It contains counts and rates only: no observation or packet IDs, candidate aliases or original IDs, mappings, per-case expected or actual answers, rankings, scores, rationales, or failure messages. The older `--json` option remains an internal backward-compatible full result with private per-case records; do not publish it. The ignored Markdown report contains the same safe aggregate view as the normal CLI.

Top-1 and top-3 acceptable rates show whether a human-approved candidate was suggested first or within the first three ranks. Forbidden-at-top-1 and forbidden-within-top-3 measure unsafe promotion only when a forbidden candidate was actually returned. Confidence-floor agreement measures whether the produced confidence met the reviewer's minimum using `low < medium < high`, without exposing individual requirements. Abstention correctness evaluates `insufficient-evidence` and `collection-unavailable` decisions: appropriate abstentions, inappropriate abstentions, and cases where abstention was expected but another recommendation was returned. Zero eligible denominators are `N/A`, never `0%`.

These deterministic metrics must be understood before an AI-reranking comparison. They never authorize locator application, replay, retries, source changes, or automatic healing.

## Limitations and safety

Synthetic tests demonstrate a zero-candidate packet, a multi-candidate packet, deterministic neutralization, validation, and separated counts. They are not production evidence. A minimum of 30 independently blind-reviewed real-shadow observations spanning applications, browsers, failure classes, and page states is recommended before even considering an isolated locator-replay experiment; sample size alone is not authorization.

The workflow makes zero network calls, requires no API key, applies no locator, retries no action, edits no source, and marks no failure as healed. Automatic healing and locator replay remain absent.
