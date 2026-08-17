# Release and marketplace checklist

This project is an independent community plugin. Publishing it does not require a pull request to the official DeepSeek Harness repository.

## 1. Verify the release candidate

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination ./dist
npm pack --dry-run --json --ignore-scripts
```

Install the generated tarball into a new DSH Web profile, dump the composed config, boot the Web UI, and verify the A/B action and workbench without browser console errors. Run a real-provider comparison and promotion smoke for every model route claimed by the release notes.

## 2. Publish the independent repository

Create `shengshifantang/dsh-evidence-arena`, push `main`, enable GitHub Actions and private vulnerability reporting, and add these repository topics:

- `dsh-plugin`
- `deepseek-harness`
- `coding-agent`
- `model-evaluation`

Do not rename or repurpose the `shengshifantang/deepseek-harness` fork. Keep it as an upstream compatibility lab.

## 3. Publish the package

The public package name is `dsh-evidence-arena`, not an `@deepseek-ai` package. Recheck that the name is available immediately before publishing, authenticate to npm, and publish only the exact tarball that passed the clean-profile smoke.

The five official SDK/child-runtime packages under `dependencies` are an intentional exception to the community recommendation to make official packages peers: the stock Web Host does not provide that child-runtime closure. They are pinned exactly to one release. All packages already provided by the Host remain optional peers. Re-evaluate this exception whenever official DSH changes its Web closure.

## 4. Submit to the community list

The curated list currently requires a repository that is at least one day old and has at least ten real commits. Once those gates and the install smoke pass, open a PR to `awesome-dsh-plugin/awesome-dsh-plugin` adding:

`data/plugins/shengshifantang__dsh-evidence-arena.yml`

```yaml
url: https://github.com/shengshifantang/dsh-evidence-arena
name: shengshifantang/dsh-evidence-arena
category: dev
description:
  en: Runs two or three coding agents on the same task in isolated Git worktrees, compares tests, latency, tokens, patch size and per-file diffs, and promotes only an explicitly selected result.
  zh: 让两到三个编码智能体在隔离 Git worktree 中完成同一任务，对比测试、耗时、Token、补丁规模与逐文件 Diff，并仅在明确确认后采纳所选结果。
```

Optionally add this screenshot mapping to `data/screenshots.json`:

```json
{
  "https://github.com/shengshifantang/dsh-evidence-arena": [
    "https://raw.githubusercontent.com/shengshifantang/dsh-evidence-arena/main/docs/images/evidence-arena-setup.png"
  ]
}
```

Regenerate the list READMEs using that repository's documented command and include only this plugin's entry plus the generated outputs in the submission PR.
