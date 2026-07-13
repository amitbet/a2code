# DynApp Package Spec

This document defines the target structure for DynApps and the rules the A2 Code
DynApp editor should enforce when users create, modify, review, and publish apps.

A DynApp is a signed, inspectable web application bundle that runs inside the
DynApp shell. The shell supplies operating-system capabilities. The app bundle
supplies product code, UI, metadata, assets, and documentation. A DynApp must be
usable by non-expert users and modifiable by A2 Code without requiring a separate
developer environment.

New DynApps should start from the official boilerplate at
`templates/dynapp-boilerplate/`. The boilerplate is itself a valid DynApp bundle:
it has `app.json`, editable source, built `dist` content, docs, license, change
tracking files, declared scripts, and no requested shell permissions.

## Goals

- Install the DynApp shell once, then install and modify apps without extra
  native setup.
- Keep app content hot-updatable and inspectable.
- Move privileged host access into shell capabilities that any DynApp can request.
- Start with the Shell capability contract over local IPC. A later remote DynApp
  stage may expose the same contract over authenticated WSS.
- Make permissions visible before install and before update.
- Grade apps for shareability and modifiability, called "modifyability" in
  user-facing store UI if we prefer that wording, so the app store can recommend
  apps that ordinary users can safely understand and change.

## Shell And DynApp Split

The shell is the trusted native boundary. It owns host authority, durable
services, secrets, package verification, and capability enforcement.

The DynApp bundle is untrusted content until installed and granted permissions.
It owns the user experience and app logic, but it cannot read files, write files,
execute commands, open terminals, access secrets, or publish updates unless those
capabilities are declared in the manifest and granted by the user.

### Shell Responsibilities

- Verify bundle signatures and checksums before install.
- Parse `app.json` and compute install/update permission warnings.
- Store grants, app-scoped secrets, trusted verification keys, audit logs, and
  durable process state.
- Expose typed shell capabilities through `window.appShell`.
- Enforce capability grants at every call boundary.
- Deny undeclared, unknown, revoked, or ungranted capabilities.
- Provide generic filesystem, networking, application, and process capabilities.
- Keep the capability contract transport-independent so a later remote DynApp
  stage can expose it over authenticated WSS without changing application logic.
- Keep long-running work alive across content reloads where appropriate.

### DynApp Responsibilities

- Render the app UI.
- Declare metadata, entrypoints, scripts, permissions, and package contents in
  `app.json`.
- Use shell capabilities instead of raw host access.
- Keep source code and assets organized enough for A2 Code to inspect and edit.
- Include license and attribution information.
- Include a modification guide when the app is meant to be changed by users.
- Handle missing permissions and unsupported shell capability versions gracefully.

## Runtime Usage

A DynApp runs in a browser-like content environment. It calls the shell through a
typed API. The exact API should remain capability-oriented rather than
app-specific:

```ts
window.appShell.capabilities.list();
window.appShell.capabilities.getGrantState();
window.appShell.fs.readText("/projects/todo/src/App.tsx");
window.appShell.fs.writeText("/projects/todo/src/App.tsx", source);
window.appShell.fs.execFile("git", ["status", "--short"], "/projects/todo");

const process = await window.appShell.process.open({
  file: "codex",
  args: ["app-server"],
  cwd: "/projects/todo",
  mode: "pipe",
});
process.write(request);
process.onStdout(handleResponse);
```

Every method is available only when the DynApp declares the matching capability
and the user grants it. A2 Code is not a privileged exception; it is a DynApp
that requests stronger editor capabilities.

The Shell contract stays generic. Product-specific operations such as applying a
patch, running a DynApp build, invoking git, or scoring a manifest are composed in
content from the generic APIs. A content helper may provide a narrow workflow API,
but it must not create a new privileged Shell namespace.

The first migration milestone uses only the local Shell over IPC. The contract
must not assume Electron IPC, so a later remote connection can return a Shell
client whose `fs`, `process`, `net`, and other groups behave like the local
groups without changing application logic.

## Bundle Structure

A DynApp bundle is a directory or archive with a manifest at the root.
The default starting shape is the boilerplate in `templates/dynapp-boilerplate/`.
A2 Code should create new DynApps by copying that boilerplate, then changing the
manifest id, name, source, docs, and UI for the user's app.

```text
my-app.dynapp/
  app.json
  LICENSE
  README.md
  CHANGELOG.md
  CHANGES.md
  FORK_NOTES.md
  content/
    index.html
    assets/
      app.js
      app.css
  src/
    App.tsx
    main.tsx
    components/
  public/
    icon.png
    screenshots/
  docs/
    modify.md
    architecture.md
  tests/
    app.test.ts
```

Required files:

- `app.json`: Manifest, permissions, entrypoints, scripts, and scoring metadata.
- `LICENSE`: License for the app code and bundled assets.
- `README.md`: What the app does, how to use it, and what it needs access to.
- `content/`: Built browser content loaded by the shell.

Required for new apps created from the boilerplate:

- `CHANGES.md`: Starts as a short summary of the initial app and continues as a
  user-readable change summary.
- `FORK_NOTES.md`: Starts with "not a fork" boilerplate and becomes mandatory
  merge documentation if the app later gains `origin` metadata.

Strongly recommended files:

- `src/`: Editable source code. Required for a high modifiability score.
- `docs/modify.md`: Human-readable modification guide.
- `docs/architecture.md`: Short explanation of the app structure and major
  decisions.
- `tests/`: Tests that can run through declared scripts.
- `CHANGELOG.md`: User-visible changes across versions.
- `CHANGES.md`: Bullet-point summary of local changes, required for forks.
- `FORK_NOTES.md`: Fork-specific implementation notes, required for forks.

Generated or vendored dependency directories such as `node_modules/` must not be
included in the bundle. The bundle should include source code, built content, and
lockfiles or dependency metadata needed to reproduce the build.

## Manifest

The manifest is the contract between a DynApp, the shell, A2 Code, and the app
store.

New DynApps generated by A2 Code should begin with the boilerplate manifest and
replace template values before the first package:

- `id`
- `name`
- `description`
- `author`
- `version`
- `assets`
- `backendPermissions`
- `repository`
- `shareability`

```json
{
  "schemaVersion": 2,
  "id": "com.example.todo",
  "name": "Todo Studio",
  "version": "1.0.0",
  "description": "A small task planner that users can customize.",
  "author": {
    "name": "Example Apps",
    "url": "https://example.com"
  },
  "license": "MIT",
  "minShellVersion": "1.0.0",
  "source": {
    "root": "src",
    "language": "typescript",
    "framework": "react"
  },
  "assets": {
    "icon": "public/icon.png",
    "screenshots": ["public/screenshots/main.png"]
  },
  "backendPermissions": [
    {
      "permission": "fs.readText",
      "reason": "Reads source files selected by the user so they can be edited in A2 Code."
    },
    {
      "permission": "fs.writeText",
      "reason": "Writes changes accepted by the user back to the selected DynApp source files."
    }
  ],
  "scripts": {
    "build": "npm run build",
    "test": "npm test",
    "typecheck": "npm run typecheck"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/example/todo-studio"
  },
  "origin": {
    "appId": "com.example.original-todo",
    "version": "1.4.2",
    "revision": "sha256:8c5d...",
    "url": "dynapp://store/com.example.original-todo"
  },
  "shareability": {
    "intendedAudience": "general",
    "modifiableByA2": true,
    "requiresExternalAccounts": false
  }
}
```

### Required Manifest Fields

- `schemaVersion`: Manifest schema version.
- `id`: Stable app identifier matching its package directory. Reverse-DNS ids are
  recommended for published third-party apps.
- `name`: User-visible app name.
- `version`: Semver package version.
- `description`: Short explanation displayed in install and store UI.
- `license`: SPDX license identifier or `SEE LICENSE IN LICENSE`.
- `minShellVersion`: Oldest shell version that can run the app.
- `backendPermissions`: Explicit list of requested shell capabilities using
  `{ "permission", "reason" }` entries. Use `[]` for apps that need no host
  authority. Reasons must satisfy the Shell's minimum specificity and length
  rules.

### Recommended Manifest Fields

- `author`
- `source`
- `assets.icon`
- `assets.screenshots`
- `scripts`
- `repository`
- `origin`
- `shareability`

## Forks And Change Tracking

A DynApp is a fork when it has an origin DynApp: it started from another app and
keeps enough history to merge from that origin or cherry-pick changes into other
forks.

Forks must declare `origin` in `app.json` and keep two human-readable files:

- `FORK_NOTES.md`: Implementation-level fork notes. This file tracks why the
  fork exists, which files or modules diverged from the origin, merge hazards,
  local invariants that must be preserved, and any upstream changes that need
  manual handling.
- `CHANGES.md`: User-facing bullet-point summary of what changed in this fork.
  This should be readable by someone deciding whether to install, cherry-pick,
  or merge the modification.

`FORK_NOTES.md` is for maintainers and A2 Code. It should help preserve new
features when merging from upstream and help downstream or sidestream forks
cherry-pick the useful parts without reverse-engineering the diff.

`CHANGES.md` is for users and reviewers. It should be concise, ordered by
release or edit session, and avoid implementation detail unless the detail
affects behavior, permissions, compatibility, or data.

### Origin Manifest Fields

- `origin.appId`: Stable id of the origin DynApp.
- `origin.version`: Origin version used as the fork base.
- `origin.revision`: Optional content hash, commit id, or store revision.
- `origin.url`: Optional store, repository, or package URL for the origin.

### Fork Maintenance Rules

- A2 Code must update `FORK_NOTES.md` when it changes architecture, data flow,
  permission behavior, merge-sensitive files, generated code, or local
  invariants.
- A2 Code must update `CHANGES.md` when it changes user-visible behavior,
  permissions, supported workflows, compatibility, data storage, or build/test
  requirements.
- Permission changes in a fork must be reflected in `app.json`, `CHANGES.md`,
  and install/update review.
- Upstream merges should preserve fork-only features unless the user explicitly
  accepts removing them.
- Cherry-pickable changes should be described with enough file/module context
  for another fork to apply them safely.

## Permissions

Permissions are deny-by-default. A shell capability will not be granted if it is
not requested in `app.json`, even if the app code calls it at runtime.

Install and update UI must show:

- New permissions.
- Removed permissions.
- Permission danger level.
- Plain-language reason from the manifest.
- Which local Shell capability is being granted.

### Permission Danger Levels

| Level     | Examples                                                          | Store/install meaning                                        |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| Low       | Notifications, opening external links, app catalog reads          | Can affect the app experience but cannot inspect user files. |
| Medium    | `fs.readText`, `fs.list`, `fs.stat`, `fs.watch`, clipboard reads  | Can inspect selected local content.                          |
| High      | `fs.writeText`, `fs.copy`, `fs.remove`, `fs.pack`, `apps.install` | Can change files or installed applications.                  |
| Very high | `fs.exec`, `fs.execFile`, `fs.execTerminal`, `secrets.manage`     | Can run code or use configured credentials.                  |

Very-high permissions should require additional confirmation and should be
called out in app-store review. Apps requesting very-high permissions can still
score well if the need is obvious, scoped, documented, and exercised through
typed workflows rather than unrestricted raw execution.

### Reuse Existing Permissions

The A2 Code migration must use the Shell's existing schema-v2
`backendPermissions` names rather than creating feature-specific aliases:

| Need                            | Existing permissions                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Select and inspect projects     | `dialog.pickPath`, `fs.home`, `fs.roots`, `fs.list`, `fs.stat`, `fs.readText`, `fs.readChunk`, `search.files` |
| Edit projects                   | `fs.writeText`, `fs.mkdir`, `fs.copy`, `fs.move`, `fs.trash`, `fs.remove`, `fs.watch`                         |
| Run bounded commands            | `fs.execFile`, with `fs.exec` only when a user-authored shell command is required                             |
| Run managed processes and PTYs  | Extend the API behind `fs.exec`; do not add a second execution permission                                     |
| Run git                         | `fs.execFile`; git parsing and workflow policy remain in content                                              |
| Build and package               | `fs.execFile`, `fs.pack`                                                                                      |
| Preview local servers           | `net.tcp.connect`, `net.tcp.listen`, `net.protocol.http`, `net.protocol.https`                                |
| Publish or call registries      | `net.protocol.https`                                                                                          |
| Browse, install, or launch apps | `apps.catalog`, `apps.install`, `apps.launch`                                                                 |

Manifest validation, shareability scoring, modifiability scoring, fork-note
maintenance, change summaries, thread reducers, diff calculation, and agent
protocol parsing run in content and require no Shell permission.

### Initial Added Permission

The local A2 Code migration needs one new generic permission:

| Permission       | Danger    | Granted behavior                                                                                                                                           |
| ---------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secrets.manage` | Very high | Create, replace, delete, and use app-scoped credentials through Shell-owned UI and secure storage. Secret values should not be readable back into content. |

If the first release relies exclusively on credentials already configured in the
Codex, Claude, or other provider CLI, it can defer `secrets.manage` too. Full
parity with A2server's configurable sensitive provider environment variables
requires it.

### Managed Process Sessions Reuse fs.exec

Commander already requests `fs.exec` for user-authored commands and
`fs.execTerminal` for an external terminal window. Those are already classified
as very-high execution authority. A2 Code needs a richer Shell API, but not a new
permission name:

Subtrans already uses `fs.execFile` results shaped as `{ code, stdout, stderr }`
to probe FFmpeg and inspect media. That existing API collects output until a
bounded process exits; it does not expose live stdin, output events, or a process
handle.

- Open and attach to long-running pipe or PTY processes.
- Stream stdin, stdout, stderr, lifecycle, and bounded replay events.
- Resize PTYs and signal, restart, or close process handles.
- Give handles ownership, leases, reconnect, and deterministic cleanup semantics.

These methods should be added to a generic `appShell.process` group and guarded
by the existing `fs.exec` permission. `fs.execFile` remains the narrower choice
for bounded argument-array commands.

`secrets.manage` must be app-scoped. A DynApp may refer to a credential when
opening a process or approved network operation, but there should be no generic
`secrets.read` permission. A user who grants both credential use and arbitrary
process execution must be warned that a spawned process can disclose those
credentials.

### Future Stage: Remote Shell Contract

Remote Shell support is not part of the initial local migration. In the next
stage, a remote DynApp connection can transport the generic Shell contract rather
than introduce an A2 Code backend or app-specific remote protocol. That stage
adds the very-high `shell.remote.connect` permission. The WSS service must:

- Pair the two Shell installations and establish revocable device identities.
- Use short-lived session credentials bound to the DynApp id, installed revision,
  requesting Shell, and granted permission set.
- Validate WebSocket Origin, prevent replay, rate-limit authentication, and keep
  an audit history of pairing and very-high capability use.
- Multiplex request/response calls and event streams for process output, file
  watches, progress, and capability changes.
- Give long-lived resources opaque handles with ownership, leases, bounded event
  replay, reconnect, cancellation, and deterministic cleanup semantics.
- Compute effective remote authority as the intersection of the manifest request,
  local connection grant, remote grant, and remote Shell support.

Any DynApp can use this contract after declaring `shell.remote.connect`. A2 Code
only adds target selection and project UX on top of it.

## Shipping Code

A DynApp should ship both built content and editable source when it wants a good
modifiability score.

Built content is what the shell loads. Source content is what A2 Code reads,
explains, edits, tests, and repackages. If a bundle ships only minified output,
it may still run, but it should receive a low modifiability score.

### Build Reproducibility

A high-quality DynApp should include:

- Source files.
- Dependency manifest, such as `package.json`.
- Lockfile, such as `package-lock.json`, `pnpm-lock.yaml`, or `bun.lock`.
- Declared `build`, `test`, and `typecheck` scripts in `app.json`.
- Clear generated-file boundaries, usually `content/` and not mixed into `src/`.
- No hidden network build steps unless documented and permissioned.

### Assets

Assets must include license or attribution information when required. Large
binary assets should be justified in the README or manifest metadata. Generated
assets should identify their source if the license or store policy requires it.

## Shareability And Modifiability Grading

The store may label the second score "modifyability" for users, but the
definition is the same: how easy the app is to understand, change, test, and
republish.

The app store and A2 Code should compute two related scores:

- Shareability: how safe and practical the app is to install, trust, and pass to
  someone else.
- Modifiability: how easy it is for A2 Code and a non-expert user to understand,
  change, test, and republish the app.

Scores should be transparent. The store should show the reason for deductions
and the concrete steps needed to improve the score.

### Suggested Score Weights

| Category                  | Weight | What earns points                                                                                |
| ------------------------- | -----: | ------------------------------------------------------------------------------------------------ |
| Manifest quality          |     15 | Complete metadata, accurate permissions, reasons, icons, screenshots.                            |
| Permission minimization   |     20 | Narrow scopes, no unnecessary very-high capabilities, clear reasons.                             |
| Source availability       |     15 | Editable source included, understandable structure, no source obfuscation.                       |
| Build reproducibility     |     15 | Lockfile, scripts, tests, generated-file boundaries.                                             |
| Documentation             |     15 | README, modification guide, architecture notes, changelog, fork notes when applicable.           |
| Licensing and attribution |     10 | SPDX license, asset attribution, dependency license compatibility.                               |
| Runtime behavior          |     10 | Handles missing permissions, works offline when expected, no surprise network or shell activity. |

An app can be shareable but not very modifiable, such as a closed-source bundled
tool with narrow permissions. An app can be modifiable but not very shareable,
such as an experimental editor that requires very-high process capabilities.
The store should show both scores separately.

### Minimum Store Compliance

A DynApp should be rejected or held for manual review when it:

- Calls shell capabilities not declared in `app.json`.
- Requests broad or very-high permissions without a manifest reason.
- Omits `LICENSE`.
- Omits required manifest fields.
- Is a fork but omits `origin`, `FORK_NOTES.md`, or `CHANGES.md`.
- Ships only opaque/minified code while claiming to be modifiable.
- Hides install-time behavior in post-install scripts.
- Requires secrets, external accounts, or remote machines without documenting
  them.
- Performs network, filesystem, process, publish, or secret operations outside
  granted capability scopes.

### High-Score Checklist

To receive a strong shareability and modifiability score, a DynApp should have:

- A complete `app.json`.
- Minimal permissions with specific reasons and user-selected paths at runtime.
- No undeclared shell capability calls.
- Source code in a predictable `src/` tree.
- Built content in `content/`.
- A recognized open-source license, or a clear proprietary license.
- Asset attribution where needed.
- README with usage, permissions, and external dependencies.
- `docs/modify.md` explaining common changes.
- `docs/architecture.md` explaining major modules and data flow.
- `FORK_NOTES.md` and `CHANGES.md` when the app is a fork.
- Tests and declared scripts for build, test, and typecheck.
- Graceful behavior when optional permissions are denied.
- No bundled secrets, tokens, private keys, or machine-specific paths.

## A2 Code Editor Requirements

The A2 Code DynApp editor should use this spec as both documentation and product
behavior.

It should:

- Open and inspect `app.json`.
- Explain requested permissions and danger levels.
- Refuse to grant capabilities that are not present in the manifest.
- Show store-score deductions before publish.
- Offer fixes for missing license, missing README, missing screenshots, broad
  permissions, missing tests, and missing modification docs.
- Keep user edits in source files, then rebuild `content/` through declared scripts.
- Diff permission changes during app updates.
- Detect forked apps through `origin` metadata and keep `FORK_NOTES.md` plus
  `CHANGES.md` current as edits are made.
- Use fork notes during upstream merges so local features are preserved unless
  the user explicitly chooses to remove them.
- Preserve audit logs for very-high capability use while editing or publishing.
- Use only the locally connected Shell in the initial migration.
- In the later remote DynApp stage, preserve the same capability contract, require
  `shell.remote.connect` before pairing, and show which Shell will execute every
  destructive or expensive action.

The editor may generate or update docs, manifests, tests, and package metadata,
but the final bundle must remain inspectable and reproducible by the shell and
the app store.
