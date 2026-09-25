---
name: tinypng
description: Compress, convert, or resize local AVIF, WebP, JPEG, PNG, APNG, or JXL images with the installed tinypng CLI. Use for deterministic Tinify-backed image optimization; do not use for visual editing or image generation.
---

# TinyPNG CLI

Use the global `tinypng` command for local image optimization. Read [references/cli.md](references/cli.md) before the first command in a task.

The default workflow is non-destructive. Never add `--replace-originals` unless the user explicitly authorizes deleting or replacing the source images. A generic request to compress, optimize, resize, or convert images does not grant that authorization.

Run `tinypng optimize ... --dry-run --json` when the input set, output names, credit estimate, or collisions are uncertain. If paid credits are required, show the user the planned paid-credit count and estimated cost, then obtain explicit authorization before rerunning with `--approve-paid N`. Do not infer financial approval from approval to optimize images.

Do not pass API keys as arguments or print credentials. Use `tinypng setup`, `tinypng config set-key`, or `TINIFY_API_KEY`.
