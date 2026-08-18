# Changelog

All notable changes to this project are documented in this file.

## 0.1.0 — 2026-08-17

- Extract Evidence Arena from the DeepSeek Harness monorepo into an independent plugin.
- Replace chat slash-command integration with an A/B sidebar action and global workbench overlay.
- Add isolated Builder worktrees, independent child runtimes, deterministic gates, Reviewer evidence, resumable state, and explicit promotion.
- Add lazy contender file trees and sealed, line-numbered per-file unified diffs.
- Add progressive Setup and preflight so new conversations remain clean.
- Add Web-first onboarding through the official Harness Workspace picker, plus an explicit one-click runnable demo repository with tests, policy, and a clean Git baseline.
- Add write-only credential setup through the official Harness credential service, removing API-key environment variables from the normal Arena flow.
- Recheck preflight on every start and route blocked launches to Setup with a visible explanation.
- Distinguish unavailable Reviewer infrastructure from an explicit model rejection and retry one bounded JSON-only finalization turn.
- Keep native DeepSeek Reviewer output budgets available for verdict JSON by disabling extended thinking, and run the one repair attempt in a fresh audit Session with the same sealed evidence.
- Add explicit, disposable loopback previews for sealed frontend candidates with launch details, bounded logs, and process-tree cleanup.
- Add artifact-bound human UAT verdicts and bounded notes after a candidate preview reaches a real loopback-ready state; persist them without changing automated ranking.
- Add a compact comparison summary for relative latency, token use, change size, gate coverage, and the transparent mechanical leader.
- Add a versioned, privacy-bounded JSON evidence report with explicit redaction, truncation, and omitted-evidence disclosures.
- Add a complete real-DSH-SDK regression covering Agent tools, worktrees, gates, Reviewers, Session evidence, preview, and promotion.
- Align the child runtime with official DSH `0.1.0-rc.7` and reuse its filesystem search, structured editor, background jobs, repository Skill discovery, compaction/pruning, todo, and in-process subagent components for Builder engineering work.
- Give every child an empty Arena-owned `DSH_HOME`/agents home so repository Skills remain available without exposing the live Host profile or its credential file to model-facing shell access.
- Preserve fail-closed promotion while distinguishing Reviewer infrastructure unavailability from an explicit code rejection at both contender and run-decision levels.
- Verify a fresh public-registry official `rc.7` Host, Web-created demo project, credential reuse, paid two-Builder/four-Reviewer model run, and sealed per-file Diff rendering.
- Verify the built tarball through a clean official DSH profile, including two installed-package Builders, four Reviewers, project tests, diff review, separate frontend previews, human UAT, promotion, restart recovery, and cleanup through scripted loopback providers.
- Keep launch and retry failures visible while background history polling continues, so a blocked preflight cannot look like an unresponsive button.
- Keep a newly started or retried run selected after history refresh instead of briefly snapping its detail pane back to the previous run.
- Migrate the browser bundle dependency policy to the current tsdown `deps` API while preserving the official module-loader boundary.
- Keep CSS virtual ids checkout-relative and reject build-machine path leakage during package verification.
- Make package verification inspect npm's exact tarball manifest so an exported runtime or documentation file cannot exist locally while being omitted from the published archive.
- Keep project tests optional by default while retaining fail-closed deterministic and security gates.
- Document the DSH execution-plane boundary, future Test Agent adapter, and long-running artifact model.
- Add standalone TypeScript, Vitest, bundle, package-closure, CI, bilingual documentation, and clean official-Host smoke coverage.
- Replace unlimited token/model-call defaults with finite whole-run guardrails, expose live usage against each limit, and require durable Host-enforced acknowledgement whenever a Profile explicitly disables a paid-usage limit, including fail-closed restart recovery for legacy unacknowledged runs.
- Expand CI to Node 22.19, Node 24, and native Windows, plus a clean official DSH rc.7 profile install/composition/HTTP smoke for the produced tarball.
