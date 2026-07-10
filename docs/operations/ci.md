# CI quality gates

- `.github/workflows/ci.yml` is a manual artifact workflow. It builds desktop artifacts and can
  build an Android standalone APK for either the `preview` or `production` mobile variant.
- `.github/workflows/release.yml` builds macOS (`arm64` and `x64`), Linux (`x64`), Windows (`x64`),
  and Android standalone artifacts, then publishes one GitHub release.
- The release workflow auto-enables signing only when platform credentials are present. macOS passkey builds additionally require `APPLE_TEAM_ID` and the `MACOS_PROVISIONING_PROFILE` secret; Windows uses Azure Trusted Signing. Without the core signing credentials, it still releases unsigned artifacts.
- See [Release Checklist](./release.md) for the full release/signing setup checklist.
