# dsh-evidence-arena

English | [中文](README.zh.md)

Evidence Arena is a **multi-model coding comparison workbench independent of chat Sessions**. Two or three Builders solve the same task in isolated Git worktrees and independent DSH child runtimes. Reproducible gates, independent Reviewers, and per-file diffs make the results inspectable. Only an explicitly confirmed candidate is written back to the original workspace.

![Evidence Arena setup and preflight workbench](docs/images/evidence-arena-setup.png)

## Delivery status

| Question | Current answer |
|---|---|
| Does it require patches to official DSH Host, command, Session, or chat UI source? | **No.** It uses only the plugin manifest, Host RPC, Workspace Registry, `sidebar.footer.action`, and `shell.overlay`. |
| Where is it opened after installation? | The **A/B** action at the bottom of the DSH sidebar. Arena no longer registers an `/arena` slash command. |
| Does a new conversation automatically show preflight warnings? | **No.** Setup and preflight are loaded only after the user opens Arena and selects that tab. |
| Can reviewers inspect actual candidate code? | **Yes.** Selecting a contender and file lazily renders the sealed line-numbered unified diff, not merely a changed-line count. |
| Can it compare two models directly? | **Yes.** Each contender may use an independent provider, model, credential reference, system prompt, and deployment identity. |
| Does it report speed, tokens, code volume, and accuracy? | It reports wall time, provider-reported tokens, calls, tools, files, changed lines, patch size, and gate results. Per-run correctness comes from project tests and Reviewers; statistical accuracy requires a multi-task benchmark. |
| Is it already published on public npm? | **No.** The independent package identity is `dsh-evidence-arena`; a built `.tgz` can be distributed now. A public npm name is not reserved until the first successful publication. |

This is an independent community project maintained at
[`shengshifantang/dsh-evidence-arena`](https://github.com/shengshifantang/dsh-evidence-arena).
The [`shengshifantang/deepseek-harness`](https://github.com/shengshifantang/deepseek-harness)
fork is the upstream compatibility laboratory, not the release repository for this plugin.

## Why this is an out-of-tree plugin

Arena integrates with the host through only two faces:

1. The Host face inserts the `arena` service through the package's `cordis.patch.yml`. It resolves a browser-supplied `workspaceId` to a trusted local path through the official Workspace Registry.
2. The browser face mounts only existing official slots: a sidebar action and a global overlay workbench. It does not inspect the chat composer, create Session commands, or require conversation rendering changes.

The published payload does not copy the complete official DSH runtime. Components already present in the Web installation are Host peers resolved through DSH's profile module fallback. Only five SDK/child-agent bootstrap packages genuinely absent from the stock Web closure are normal Arena dependencies. This keeps the isolated child runtime bootable without duplicating Cordis or pulling native runtime branches such as `node-pty` and `koffi`. Those five prerelease packages are pinned exactly to `0.1.0-rc.6` so that one partially published DSH release cannot silently replace only part of the child-runtime closure.

The compatibility boundary is therefore explicit: use Arena with the DSH release family against which it was built. Re-run installation and browser smoke tests across upgrades instead of assuming private interfaces are permanently stable.

### Verified compatibility snapshot — 2026-08-17

- The standalone repository passes both TypeScript faces, 16 test files / 64 tests, Host ESM build, browser loader build, and package-closure verification on macOS.
- The `0.1.0` tarball was installed with exit code 0 into a new profile built from clean official commit [`47f943859b`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859b), whose CLI identifies as `@deepseek-ai/dsh@0.1.0-rc.5`. Config composition included `id: arena`; Web boot returned HTTP 200; the boot manifest and client bundle both included `dsh-evidence-arena`; the A/B action opened the two-tab workbench with no browser console errors.
- That clean-profile smoke intentionally used no model credential. It proves installation, Host composition, RPC/client loading, and UI rendering; a fresh real-provider comparison and promotion run is still required before claiming end-to-end acceptance for a particular model route.
- A fresh public-registry install of `@deepseek-ai/dsh@0.1.0-rc.6` was also attempted on this date. It was blocked upstream because floating official dependencies selected some `rc.7` packages while `@deepseek-ai/dsh-tools@^0.1.0-rc.7` was unavailable. This is not an Arena failure, but it currently prevents using a brand-new official CLI install as the smoke host. Recheck the official registry state before removing this notice.

## User installation

Before the first npm release, install the locally built or GitHub Release tarball:

```bash
dsh plugin --profile web add \
  /absolute/path/to/dsh-evidence-arena-0.1.0.tgz
```

After it is published to public npm, the user command becomes:

```bash
dsh plugin --profile web add dsh-evidence-arena@latest
```

The current DSH profile exposes official dependencies through a Host fallback that the package manager cannot see, so pnpm may print one generic `Issues with peer dependencies found` warning. This is not a native-build failure. Acceptance requires a zero install exit, no ignored-build list, and an immediately successful DSH boot. A boot failure must not be ignored or relabeled as success.

Start official DSH from a Git repository:

```bash
cd /absolute/path/to/target-repository
export DEEPSEEK_API_KEY='<your-key>'
dsh --profile web --host 127.0.0.1 --port 4188
```

Open `http://127.0.0.1:4188`, add or select the target Workspace in official DSH, and click **A/B** at the bottom of the sidebar.

The package intentionally does not use the `@deepseek-ai` namespace and must not be presented as an official DeepSeek release.

### Build the tarball from this repository

Developers need a repository-supported Node.js version (`^22.19.0` or `>=24.0.0`), Git, and pnpm:

```bash
git clone https://github.com/shengshifantang/dsh-evidence-arena.git
cd dsh-evidence-arena
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination ./dist
```

Distribute the resulting `dist/dsh-evidence-arena-*.tgz`. Consumers do not need the deepseek-harness source checkout and do not rebuild the plugin.

## First run

1. Ensure the target is a non-bare Git repository and commit or otherwise handle existing changes. Arena requires a clean base so user-owned edits cannot be mixed into contender results.
2. Add the target Workspace in the DSH sidebar.
3. Click **A/B** to open Evidence Arena and select the Workspace.
4. Open **Setup and preflight**. Git, credentials, policy, routes, Reviewer independence, and sandbox facts are checked only after this explicit action.
5. Repair blockers. The usual defaults are a missing `DEEPSEEK_API_KEY` and no project test command.
6. Return to **Runs and code review**, enter the shared coding task, and click **Start parallel comparison**.
7. When the run finishes, switch contenders, inspect gates and Reviewer evidence, and select files from the tree to read their exact diffs.
8. To use one result, first select **Prepare promotion** and inspect the artifact hash and gates. After explicit acknowledgement, Arena reruns required deterministic gates before writing to the original Workspace.

Arena never commits, pushes, opens a PR, or deploys. After promotion, inspect `git diff` and choose the Git workflow yourself.

## What can be compared

| Dimension | Arena evidence | Interpretation boundary |
|---|---|---|
| Speed | Per-node and whole-run wall time | Network, provider queues, and local gates affect it; repeat runs and compare distributions |
| Tokens | Provider-reported input, output, reasoning, cache, and total tokens | Missing telemetry is not guessed; tokens are not money |
| Behavior | Model-call count, tool-call count, and recent activity | Exposes differences such as direct editing versus evidence-first discovery |
| Code volume | Files, additions/deletions, and patch bytes | Smaller is not automatically better; this supports transparent ranking and cost review |
| Correctness | Project tests, quality commands, integrity/security gates, and logic/security Reviewers | Evidence for this task, not a mathematical proof |
| Inspectability | Candidate tree, per-file unified diff, Builder report, and gate output | Large files are bounded; binary content is represented by metadata |

The mechanical leader is selected only among candidates that passed every required gate, then ordered by changed lines, patch bytes, and configured order. It does not mean “Arena proved this model is smarter.” To calculate model accuracy, use a fixed task set with hidden tests or human gold labels, repeat each model, and aggregate pass rate, cost, and latency distributions.

## Execution and security model

0. **Explicit preflight:** Arena checks repository, credentials, policy, route identity, and sandbox conditions only after the user opens Setup; a new chat remains clean.
1. **Freeze the base:** lock the exact `HEAD` and create one detached worktree per Builder.
2. **Share context:** read a bounded file index and selected files once from the immutable commit, hash them, and reuse the exact bytes for every Builder.
3. **Build independently:** each Builder gets an independent child runtime, route, credential references, tools, and worktree.
4. **Seal evidence:** capture the tracked patch and regular untracked files before any Reviewer starts, bound to SHA-256. Symlinks, gitlinks, special files, path escapes, and oversized artifacts fail closed.
5. **Run deterministic gates:** apply integrity, secret/path/binary rules, `git diff --check`, and repository-declared quality/test argv.
6. **Review without tools:** Reviewers receive only a bounded sealed artifact and deterministic evidence. They get no shell, file tools, Skills, contender id, or live worktree.
7. **Promote in two phases:** create a short-lived artifact-bound preview token, require human confirmation, rerun gates in a fresh isolated tree, then write exact bytes.

Harness confines file writes, but the current sandbox **does not isolate network access or guarantee isolation of every host read**. Put adversarial code in a container or VM and use least-privilege credentials.

## Repository policy pack

The default file is `.dsh/arena-policy.json`. It is a versionable and reviewable project acceptance contract. Setup generates a complete template. Unknown fields, omitted fields, unsafe paths, shell strings, and invalid signatures block explicitly rather than silently falling back.

This is a complete baseline example:

```json
{
  "schemaVersion": 1,
  "policyId": "project-arena-policy",
  "revision": "1",
  "rules": {
    "judgeCommands": [
      {
        "id": "tests",
        "label": "Project tests",
        "stage": "test",
        "required": true,
        "command": "npm",
        "args": ["test"],
        "timeoutMs": 120000
      }
    ],
    "requireChanges": true,
    "requireProjectTests": true,
    "requireLogicReview": true,
    "requireSecurityReview": true,
    "allowBinaryFiles": false,
    "maxChangedFiles": 500,
    "maxReviewInputChars": 200000,
    "protectedPathPatterns": ["^\\.env(?:\\.|$)"],
    "sharedContextPaths": ["AGENTS.md", "package.json"]
  }
}
```

Commands are a `command` plus `args` array and never pass through a shell, so pipes, redirects, substitutions, and command chaining are not interpreted. With `policySignatureMode: require`, detached Ed25519 signatures can be checked against Host-configured public keys. Arena never accepts a signing private key.

## Configure two different models

Edit the Web profile user patch, normally `$DSH_HOME/profiles/web/cordis.patch.yml`, and target the `arena` id. This example uses an abstract OpenAI-compatible route; replace its URL, model ids, and environment variable with your deployment:

```yaml
- id: arena
  config:
    providerProfiles:
      compare-gateway:
        apiKeyEnv: COMPARE_API_KEY
        api: openai-completions
        baseURL: https://models.example/v1
        models:
          - id: model-a
          - id: model-b
    contenders:
      - id: model-a
        label: Model A
        provider: compare-gateway
        model: model-a
        credentialEnv: [COMPARE_API_KEY]
        identity:
          organization: vendor-a
          gateway: models.example
          modelFamily: family-a
        systemPrompt: Implement the task completely and verify it.
      - id: model-b
        label: Model B
        provider: compare-gateway
        model: model-b
        credentialEnv: [COMPARE_API_KEY]
        identity:
          organization: vendor-b
          gateway: models.example
          modelFamily: family-b
        systemPrompt: Implement the task completely and verify it.
```

The default is not a two-model benchmark: it uses the same DeepSeek route with Direct and Evidence-first working styles. For a true model comparison, separate contender models and identities and give them the same task, policy, and preferably the same system prompt. Serious evaluation should also put Reviewers on a provider, organization, gateway, and model family disjoint from the Builders.

## Durable state and recovery

Arena v4 stores events, atomic snapshots, shared context, sealed artifacts, Setup reports, and child Sessions under `$DSH_HOME/arena/v4` by default. State is owned by `workspaceId`, not by a chat Session or a path supplied by the browser.

Each contender advances through `admitted → worktree-ready → builder-complete → artifact-sealed → decision-complete`. After Host restart, Arena validates registered worktrees, shared context, and artifact hashes, then resumes the earliest incomplete checkpoint. Promotion uses a `prepared → applying → applied → committed` write-ahead record. An exact Arena-owned partial write can be rolled back; user bytes or divergence produce `needs-attention` instead of being overwritten.

v4 intentionally rejects v3 and earlier pre-release state instead of guessing a migration. Keep an old directory as audit evidence if required and start new tasks in v4.

## Authority boundaries

- `/arena-read` returns runs, Setup, and on-demand file diffs over a trusted-host channel.
- `/arena-control` starts, retries, cancels, cleans up, writes policy, and promotes only from loopback pages.
- Remote pages can inspect evidence but cannot mutate a repository through the workbench.
- The browser submits only an official `workspaceId`; the Host resolves the path from Workspace Registry and rejects browser-forged directories.
- Credentials are resolved by reference. Secret values never enter Arena config, state, logs, RPC, or cards.

## Known limitations

- Windows paths and runtime composition have static and simulated coverage, but current development acceptance ran on macOS. Real Windows ACL, junction, Git, and process behavior still needs native CI.
- Network access and all host reads are not isolated.
- Token and call budgets depend on provider telemetry; an in-flight request can exceed a limit by one reporting interval.
- Reviewer and rule evidence does not replace complete SAST, formal verification, or human domain review.
- Ordinary filesystems cannot make a multi-file working-tree write fully atomic; Arena adds WAL, revalidation, and divergence protection.
- `dsh-evidence-arena` was unclaimed on public npm when this repository was prepared, but only a successful first publication reserves it. Recheck immediately before release.
- Only DSH versions compatible with the current out-of-tree plugin seams are supported; rebuild and reverify after official interface changes.

## Uninstall

```bash
dsh plugin --profile web remove dsh-evidence-arena
```

Uninstalling the plugin does not delete audit evidence under `$DSH_HOME/arena/v4` and does not revert code already promoted into a Workspace. Archive or remove that data explicitly only after it is no longer required.
