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
npm run ai:locator:holdout:evaluate:blind -- --plain
npm run ai:locator:holdout:evaluate:blind -- --no-animation
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

## Advisory reranking comparison

The comparison runner preserves the existing deterministic result and evaluates the same eligible blind cases through an optional second phase. Before any human answer is loaded, a validated blind packet is explicitly mapped to bounded AI evidence. Its already neutral, reproducible aliases and order prevent `LOCATOR-001` rank anchoring. The provider sees target intent, sanitized failure/readiness state, collection status, and safe candidate facts; it never sees the original IDs, mapping, deterministic score/rank/rationale, or completed review.

```text
npm run ai:locator:holdout:compare
npm run ai:locator:holdout:compare -- --mode=mock-ai
npm run ai:locator:holdout:compare -- --mode=mock-ai --summary-json
npm run ai:locator:holdout:compare -- --mode=mock-ai --plain
npm run ai:locator:holdout:compare -- --mode=ai-advisory --confirm-network
```

The default is deterministic-only. Mock mode makes zero network calls and needs no key. Live mode is local-only, reuses the OpenRouter adapter, and requires explicit enablement, network consent, model, key, and pricing configuration. It is absent from tests and CI. Public terminal output, ignored Markdown, and safe summary JSON show only aggregate deterministic/advisory metrics, direction-aware deltas, provider request coverage/usage, and isolation guarantees. They never contain prompts, raw responses, case IDs, candidate IDs, mappings, per-case answers, or rationale.

Provider failure, timeout, rate limiting, and rejected structured output are reported as unavailable or partial coverage. Those cases are excluded from AI-specific denominators; deterministic results remain visible but are not relabelled as AI results. Higher is better for agreement, acceptable/preferred ranking, and confidence-floor metrics. Lower is better for forbidden promotion, unsafe recommendations, invented IDs, prohibited output, and high-confidence mistakes. `N/A` remains `N/A` when no denominator exists. Five cases remain insufficient for a production claim, and no apparent delta authorizes replay or healing.

Live locator advisory uses strict JSON Schema with provider capability filtering; it never silently retries through weaker generic JSON mode. The public comparison report may show aggregate validation issue categories such as `unsupported-field` or `unknown-candidate-id` when invalid output occurs. It never shows the provider value, candidate alias, case ID, prompt, raw response, mapping, or reviewer data. Verify the live contract first with `npm run ai:locator:reranking:verify -- --confirm-network`; that command uses synthetic compiled evidence and reads none of these ignored artifacts.

The shared live advisory configuration caps generation at 2,000 tokens and provider latency at 30 seconds. Both values match global defaults; callers may configure smaller values through the existing bounded minimum. The token allowance includes hidden reasoning but does not expand the strict five-field output or 500-character summary. Truncation and timeouts remain unavailable advisory results rather than partial answers, retry policy remains unchanged, and no extra provider metadata request, model-specific limit, locator application, or healing occurs.

## Terminal output modes

The normal command chooses rich output only when stdout is an interactive terminal, CI is absent, `TERM` is not `dumb`, and the terminal is at least 72 columns wide. Terminals at 80 columns and above receive bordered panels; 72–79 columns receive compact rich headings. Narrower terminals use plain output. Rendering is capped at 140 columns so a very wide terminal remains easy to scan. Rich output groups status, eligibility, diagnosis, recommendation, ranking, safety, confidence, abstention, isolation, interpretation, and elapsed time. Each section calculates one label width, and wrapped values align beneath their value rather than repeating labels or status markers. Labels accompany every color and symbol so color is never the only signal.

Progress is delayed for 400 ms to avoid flicker and names only work the command is actually performing: loading records, counting pilot reviews, validating packet/mapping integrity, translating aliases and evaluating, calculating the safe aggregate, and writing reports. A command that finishes before the delay produces no progress output. The rich default is `thinking`: only message brightness pulses through dim → normal → bright → normal → dim → normal every 150 ms. The symbol and ellipsis remain stable, and ANSI blink is prohibited. Animation is transient stderr output; metrics remain stdout output. Ctrl+C, failure, exception, process exit, and normal completion reset ANSI, clear the line, and restore the cursor. CI, pipes, JSON, and plain mode never animate.

```text
┌ AegisAI · Blind Locator Holdout ───────────────────────────┐
└────────────────────────────────────────────────────────────┘

┌ RUN STATUS ────────────────────────────────────────────────────┐
│  Mode:          deterministic-only                             │
│  Sample status: INSUFFICIENT-SAMPLE                            │
└────────────────────────────────────────────────────────────────┘

[WARNING] The reviewed sample is directional evidence, not production proof.
```

Use `--plain` for stable ASCII text:

```text
AEGISAI - BLIND LOCATOR HOLDOUT

RUN STATUS
  Mode:          deterministic-only
  Sample status: INSUFFICIENT-SAMPLE
```

`--progress-style=thinking`, `--progress-style=spinner`, and `--progress-style=static` select a validated progress style. `--no-animation` keeps rich static formatting on a capable interactive terminal but disables cursor animation. `--emoji` requests emoji, `--no-emoji` selects the Unicode fallback, `--unicode` requests Unicode, and `--ascii` forces ASCII-safe symbols and borders. Conflicting or misspelled options fail through a bounded structured error without a stack trace.

Actual stream capabilities are authoritative. `WT_SESSION` and `TERM_PROGRAM` are positive hints only; missing values never override a TTY that reports ANSI support through `getColorDepth()` or `hasColors(16)`. A capable interactive Win32 stream may auto-select the stable `💭` thinking symbol; other supported Unicode terminals use `↻`, and ASCII mode uses `[~]`. All three symbols support thinking. Standalone completion messages use `✅`/`⚠️`/`❌`/`ℹ️` in emoji mode, `✓`/`⚠`/`✗`/`○` in Unicode mode, and labelled ASCII forms such as `[OK]` and `[FAIL]`. Metric tables continue using labels and stable-width content rather than colorful double-width emoji. `NO_COLOR` and `FORCE_COLOR=0` disable semantic color without automatically disabling Unicode, emoji, or supported brightness styling. Narrow terminals, `TERM=dumb`, redirected output, and CI automatically use plain mode. Screen readers can rely on headings and explicit semantic labels rather than color or symbols alone.

To inspect progress behavior without reading observations, running business evaluation, or contacting a network service, use:

```powershell
npm run cli:demo:progress
npm run cli:demo:progress -- --progress-style=thinking --emoji
npm run cli:demo:progress -- --progress-style=thinking --no-emoji
npm run cli:demo:progress -- --progress-style=thinking --ascii
npm run cli:demo:progress -- --progress-style=spinner --unicode
npm run cli:demo:progress -- --progress-style=static
npm run cli:demo:progress -- --no-animation
npm run cli:demo:progress -- --plain
npm run cli:demo:progress -- --diagnose-terminal
```

The demo has five deterministic 900 ms stages (approximately 4.5 seconds) and exists only for explicit local presentation testing; CI does not invoke it. It reads no observations, calls no browser or provider, requires no key, and performs no evaluation, locator application, or healing. Its `💭` symbol means only that CLI presentation work is active. AI-specific messages belong only in a future command that genuinely calls a provider.

Machine consumers should use `--summary-json`. It emits valid aggregate JSON only, with no banner, spinner, ANSI, Markdown, or trailing prose. The backward-compatible `--json` mode is also pure JSON, but contains private per-case records and must not be published. Expected command-option errors render as bounded structured blocks without stack traces; commands never repair review data automatically.

## Limitations and safety

Synthetic tests demonstrate a zero-candidate packet, a multi-candidate packet, deterministic neutralization, validation, and separated counts. They are not production evidence. A minimum of 30 independently blind-reviewed real-shadow observations spanning applications, browsers, failure classes, and page states is recommended before even considering an isolated locator-replay experiment; sample size alone is not authorization.

The workflow makes zero network calls, requires no API key, applies no locator, retries no action, edits no source, and marks no failure as healed. Automatic healing and locator replay remain absent.
