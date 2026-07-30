# CI quality gates

> For maintainers. Using A2 Code? See [docs/user](../user/).

This fork trims the upstream Actions surface to two build-only workflows. CI does **not** gate on
lint, typecheck, or tests — run `vp check`, `vp run typecheck`, and `vp run test` locally before
merging (see [FORK_NOTES.md](../../FORK_NOTES.md)).

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) is a manual ("Build Artifacts")
workflow. It builds unsigned desktop artifacts (macOS `arm64`/`x64`, Linux `x64`, Windows `x64`) and
can build an Android standalone APK for either the `preview` or `production` mobile variant.

[`.github/workflows/release.yml`](../../.github/workflows/release.yml) builds the same platforms as
**unsigned** artifacts from a single `v*.*.*` tag. A dedicated `build_payload` job builds the desktop
payload hot-update asset (`payload-*.tar.gz` + signed `payload-manifest.json`); the `release` job
depends on that job rather than on the slow desktop builds, and each desktop binary attaches
afterwards via an `append_<platform>` job.

Both workflows cache the Electron/electron-builder downloads before every desktop build and raise
`ulimit -n` on macOS; see FORK_NOTES.md for why those deviations exist.

See [Release Checklist](../operations/release.md) for the release process.
