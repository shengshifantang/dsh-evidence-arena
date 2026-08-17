# Contributing

Evidence Arena is an independent community plugin for a fast-moving developer-preview host. Changes should keep the Host boundary explicit and evidence-backed.

## Local checks

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination ./dist
```

For Host integration changes, also install the generated tarball into a new DSH Web profile and verify that:

1. `--dump-config` contains `id: arena`;
2. the Web boot manifest contains `dsh-evidence-arena`;
3. the client bundle returns HTTP 200;
4. the A/B sidebar action opens the workbench without console errors.

Do not commit credentials, generated Arena run state, worktrees, or user repository content. A failed check must remain visible; do not weaken a required gate merely to make CI green.

## Compatibility changes

When changing an official DSH dependency or seam, record the exact DSH version or commit, operating system, Node.js version, installation result, browser smoke result, and any unverified boundary in both READMEs.
