# TinyPNG CLI reference

## Commands

```text
tinypng setup
tinypng status [--json]
tinypng optimize <paths...> [options]
tinypng config set-key|delete-key
tinypng skill install|status|remove
```

`optimize` accepts files and directories. Directories are shallow unless `--recursive` is provided. Symlinks are rejected or ignored during traversal.

## Formats and names

`--format same` is the default. Other values are `avif`, `webp`, `jpeg`, `png`, `jxl`, `smallest`, or a comma-separated candidate list such as `avif,webp,jxl`.

The default is non-destructive:

- Same format: `photo.png` becomes `photo-optimized.png`.
- New format: `photo.png --format avif` becomes `photo.avif` and keeps `photo.png`.
- A dynamically selected result that keeps the source format uses `-optimized`.

The CLI aborts before network work if an existing or duplicate possible output would collide. It never invents numbered suffixes.

`--replace-originals` is destructive. It atomically replaces same-format sources or removes a differently formatted source only after the new output is verified. Obtain explicit user authorization immediately before using it.

## Resize

```text
--resize scale --width 800
--resize fit --width 800 --height 800
--resize cover --width 800 --height 800
--resize thumb --width 800 --height 800
```

`fit` does not add padding. `cover` crops. `thumb` may crop or add algorithm-selected background, but Tinify does not guarantee its color or transparency. `--background white|black|#RRGGBB` fills existing transparency during conversion and does not control background that `thumb` may create.

## Credits and approvals

The first 500 monthly compressions are free under Tinify's published pricing. The CLI estimates one credit for plain same-format compression and two for a conversion or resize. Actual account count returned by Tinify remains authoritative.

When a plan crosses the free allowance:

- An interactive human must type the requested `APROBAR N` phrase.
- Agents, JSON mode, and non-interactive runs require `--approve-paid N`.
- `N` is a per-run maximum and is never persisted.

Tinify does not expose card state or prepaid balance through its documented API. Treat displayed USD amounts as estimates and link the user to https://tinify.com/pricing/api for current pricing.

## Agent-friendly output

Use `--json` for a versioned plan/result containing deterministic item order, paths, planned deletions, dimensions, sizes, hashes, usage, approval state, and structured errors. JSON mode never prompts.
