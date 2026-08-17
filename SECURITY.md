# Security Policy

## Reporting

Please use GitHub private vulnerability reporting for sensitive findings after the repository is published. If that channel is unavailable, open a minimal issue that contains no exploit, credential, private path, repository content, or secret and ask the maintainer for a private channel.

Never attach API keys, Arena state directories, Session logs, model transcripts, or proprietary candidate patches to a public issue.

## Scope and response boundary

Security-sensitive areas include workspace-path resolution, credential references, loopback mutation authorization, Git worktree isolation, artifact hash binding, gate execution, WAL promotion, and secret redaction. Reports should include a minimal reproduction and the affected plugin and DSH versions where possible.

This project is pre-1.0 and follows the compatibility limits stated in the README. A report acknowledgement does not mean a fix has been released; rely on an identified patched version or commit.
