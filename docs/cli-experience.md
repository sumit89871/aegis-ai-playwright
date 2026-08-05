# CLI presentation experience

The reusable CLI layer renders plain result objects; it does not calculate validation or evaluation outcomes. Future advisory or guarded workflows should reuse this layer instead of duplicating timers or ANSI sequences.

## Thinking progress

Rich interactive terminals default to `thinking`. After a 400 ms delay, the message pulses every 150 ms through this exact sequence:

```text
dim → normal → bright → normal → dim → normal
```

The symbol, space, message text, and ellipsis keep the same terminal-cell width. Only the message brightness changes. ANSI blink is prohibited because support and accessibility are inconsistent. Every frame resets styling, and completion cancels unref'd timers, clears the transient stderr line, and restores the cursor before permanent stdout output.

Capability detection reads the actual output streams without emitting probe sequences. stdout controls permanent rich reports; stderr controls transient progress. `isTTY`, `getColorDepth()`, `hasColors(16)`, and `columns` are authoritative when available. `WT_SESSION` and `TERM_PROGRAM` remain positive hints, but their absence is never negative evidence. An interactive Win32 stream reporting at least four-bit color or basic 16-color support is treated as ANSI SGR, brightness, cursor-control, and Unicode capable; the current auto policy also permits the professional `💭` progress emoji. A supported non-emoji terminal uses `↻`; ASCII mode uses `[~]`.

Requested and effective progress styles are distinct and the diagnostic reports any controlled fallback reason. Thinking works with emoji, Unicode, and ASCII symbols. It falls back to the rotating spinner only when transient stderr can animate but genuinely lacks ANSI brightness; missing emoji, missing Unicode, disabled semantic color, or absent terminal-brand variables do not cause spinner fallback. Static mode prints truthful stage text without cursor animation. Plain, JSON, CI, redirected, non-TTY, and `TERM=dumb` output never animates.

## Options

```powershell
npm run cli:demo:progress -- --progress-style=thinking
npm run cli:demo:progress -- --progress-style=spinner
npm run cli:demo:progress -- --progress-style=static
npm run cli:demo:progress -- --emoji
npm run cli:demo:progress -- --no-emoji
npm run cli:demo:progress -- --unicode
npm run cli:demo:progress -- --ascii
npm run cli:demo:progress -- --no-animation
npm run cli:demo:progress -- --plain
npm run cli:demo:progress -- --diagnose-terminal
```

`--unicode` and `--ascii` conflict. `--emoji` and `--no-emoji` conflict. `--ascii --emoji` is invalid. Output contracts are resolved first, then explicit symbol restrictions, explicit emoji preferences, and finally auto-detection. Unsupported progress styles fail with a safe code, option name, supported values, and remediation—never a stack trace. `NO_COLOR` and `FORCE_COLOR=0` affect semantic color, not Unicode, emoji, or supported dim/bright animation.

The diagnostic prints only TTY booleans, stream color depths/basic-color support, bounded width, CI/dumb-terminal booleans, Windows Terminal hint presence, controlled capability sources, requested/effective symbol/emoji/progress modes, ANSI/animation/color booleans, fallback reason, and timing constants. It never prints `WT_SESSION`, environment contents, paths, usernames, or secrets.

## Output and accessibility contracts

Transient progress uses stderr. Permanent reports and summaries use stdout. `--summary-json` remains aggregate-only; private `--json` remains the existing internal result. Both are pure JSON with no animation, emoji, ANSI, cursor bytes, or trailing prose.

Colors and symbols supplement semantic text; they never replace it. Screen readers and plain logs retain explicit labels. Emoji are used for transient progress and standalone completion messages, not aligned metric columns. ANSI-aware terminal-cell measurement prevents emoji, Unicode, and styled text from shifting panels or animation frames.

Animation is presentation only. `💭` does not imply an AI call, and no progress style authorizes locator application, source changes, replay, retries, or healing.

## Advisory comparison progress

The locator advisory comparison consumes the same presentation API. Live mode reports only truthful work stages: loading eligible packets, preparing sanitized evidence, requesting advisory reranking, validating structured responses, loading independent human answers afterward, comparing rankings, calculating aggregate deltas, and writing privacy-safe reports. Deterministic and mock modes never claim a live provider request.

Invalid strict locator output may add aggregate validation issue categories to the provider section. These are stable bounded codes only; the renderer receives no raw response, prompt, candidate ID, human answer, or per-case validation value. The separate synthetic verifier uses plain safe lines so its one-request result can be captured without generating artifacts.

Transient stages remain stderr-only and stop before the permanent stdout report. `--summary-json`, `--plain`, CI, `TERM=dumb`, and redirected execution remain free of animation. The normal 400 ms delayed start is unchanged, so a fast comparison can complete without showing progress. Presentation does not change any deterministic or advisory metric.
