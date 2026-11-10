# Unified entry design QA

final result: partial — browser smoke verified; native interaction pending

## Visual target

Source: `/Users/didi/.codex/generated_images/01a0c3c6-449d-7491-8d96-7d5707473627/exec-72325aaa-d298-4d70-9067-c31673ff12f2.png`.
Approved interaction: launcher entry plus companion and artifact workspace, not three separate products.
Target viewport: 1440 × 1024; also verify 780 × 700 and 560 × 840 desktop modes.

## Capture and comparison

Implementation screenshot: unavailable. In-app browser kernel exits before navigation with `sandbox-exec: unbound variable: TIOCSTI`.
The user has approved independent browser verification. Reading the Playwright skill is currently blocked by the local data-security Hook; permission is no longer the blocker. No bypass or whitelist modification was attempted.
Full-view comparison, focused-region comparison, pixel-density normalization, rendered fonts/spacing/colors/assets/copy: not performed. No fidelity pass is claimed.

## Findings

- [P1] Browser verification blocked. A running loopback server and module unit coverage do not prove visible layout, focused input, native select popup, or main path interactions.
- [P1] Native acceptance blocked by missing Rust toolchain; no macOS/Windows release build or global-shortcut acceptance evidence.
- [P2] Durable local draft recovery and external application attachment are not implemented. Current UI must keep its explicit local-only and selected-text disclosures.

## Iteration history

Initial implementation only; no screenshot-based QA iteration has completed. Source-derived mock and Node DOM-port tests are not implementation screenshots.
Follow-up unit verification fixes uncertain-result replay after refresh/task switches: 11/11 entry tests pass and the three entry JS modules retain 100% line/function/branch coverage. The guard is per-window draft state, not durable server idempotency; this does not change the blocked visual/native result.
The whole-project Premium static audit did not finish and its long-running process was stopped; no static compliance pass is claimed. Official DESIGN.md lint was not run because the tool is not installed and this task forbids adding dependencies.

## Next checks

With user-approved independent browser: inspect launcher, companion, workspace, no-model and failure states; upload bounded text, switch tasks, retain edits, check keyboard/narrow/dark/reduced-motion behavior and console errors. Capture source and implementation together at matched viewport/state. Fix P0/P1/P2 issues before passing QA.


## Current verification: 2026-10-30

Current native Rust tests (6) and debug executable build passed after installing a persistent Rust toolchain. A process-level launch/termination check confirmed the new executable starts its own sidecar and the sidecar exits when its parent terminates. Native UI automation remains unavailable due to Sky Computer Use service startup failure; no native interactive acceptance is claimed.

Real Ego browser validation completed the new-session display and one isolated software evaluation (1/1 passed) against the installed core package. Captures: `/tmp/craft-ui-validation/01-new-session.png`, `03-evaluation-result.png`, `04-evaluation-aligned.png`, `05-evaluation-narrow.png`. Images were inspected. Evaluation alignment and input styling were corrected; the 780px check reported no document horizontal overflow. These captures cover a browser surface, not a Tauri window, and do not establish all accessibility or interaction requirements.

## Current verification: 2026-11-08/09 (three-mode Workbench, this iteration)

Scope: `craft-workbench` mock runtime (`node scripts/mock-runtime-server.mjs`), Playwright-driven browser surface, final tree at commit 640ba96. These runs are browser evidence; they do not establish Tauri-window or real-CLI acceptance.

### Verified (browser, end-to-end)

- Connection: an open runtime shows 已连接 · 仅本机 on both rail and status bar; the boot gate asks the runtime before declaring 未授权. A transient probe failure self-heals via the capped watchdog (5s→60s backoff, 24 attempts).
- Pages: all 28 routable pages render a heading, controls and honest empty states; deep links carry identity parameters; the static chain (entry plus every `app.js` import) is served over real HTTP.
- Cross-projection navigation: overview 去看 (approvals/objects/subscriptions), the hatch sheet and task-detail 新建任务 all adopt the owning projection via `adoptModeFor` plus a single `go`; mode tab, rail and page stay consistent. A `modeForPage` missing-import regression surfaced as a page crash and is now pinned by tests.
- Hatch chain: the sheet opens after paint (no outgoing-DOM write), submit returns the created object, toast 已创建, landing on 我的对象 focused on the new object.
- Composer mentions: `@` lists files (query-filtered, no null) plus 手动选择; `/plan` and `/goal` built-ins; keyboard selection inserts `@lib/client.js `; send stays disabled until tool/model are chosen.
- Console data surfaces: approvals (open card + learned rule + L1/HT paired), objects (three buckets + focus adjudication with a composed comparison control), subscriptions (active vs suspended drift with changed fields), relation health (internal gaps vs external references), memory/knowledge/experience rows with recall-audit and trend affordances.
- Evaluation: start → polling → 已生成报告 (通过 2 · 失败 0, provenance run id + evaluator version); cancel → 已取消 (terminal); compare → 有效配对 2/2 (insufficient with fewer than two distinct completed runs); knowledge gate → eligible/ineligible with reasons.

### Fixes shipped this iteration (each with regression tests)

Self-healing watchdog and unauthorized gate (`workbench/connection-state.js`, 100% line/branch/function coverage); live-401 boot gate; executor permission undefined fallback; mock no-cache headers; route-order fixes (picker/files versus the agent-sessions catch-all); rich mock data for approvals/objects/drift/relations/designs; hatch cross-projection plus after-paint plus `pending.run(panel)`; task-detail 新建任务 projection; evaluation mock id derivation sha256(operation_id); cancel/compare/knowledge-assess endpoints.

### Not verified (honest gaps)

- Tauri desktop window and real CLI sessions (Codex/Claude/DSH) remain unverified in-browser; mock state is in-memory and resets on restart.
- The evaluation unknown→reconcile recovery branch and the knowledge-gate ineligible path are unit-tested only.
- The `craft` full 365-file suite was not run; the craft-eval gate covers the deterministic subset (7/7 on the final tree; craft-eval self-suite 121 pass/0 fail, 26 POSIX-skipped).
- The `craft` repo carried unrelated uncommitted parallel work (`prov.lcov`, `provenance.lcov`); untouched.
