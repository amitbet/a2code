# FORK_NOTES.md

This file tracks fork-specific divergences that are likely to conflict when
merging `upstream/main`.

## 2026-09-01 upstream merge (draft promotion gate, timeline `thinking` row) — migration notes

Merged `upstream/main` through `b17cc3d1b` (27 commits). Small merge — 7 conflicts, all
mechanical except the draft-promotion one below.

- **No migrations arrived.** Upstream is still at its 043; the fork's renumbered 044-046 are
  untouched. Fork's next free id is still **47**.
- **The fork's `threadHasAuthoritativeUserMessage` draft-promotion gate was RETIRED.** Upstream
  reworked `resolveDraftPromotionNavigationTarget` (`apps/web/src/components/ChatView.logic.ts`) to
  take the whole `serverThread` and gate on `latestTurn.startedAt != null || session.status is
error/stopped/interrupted`. That gate fires strictly later than the fork's "the server echoed a
  user message" check (the prompt event that creates the user message also creates the turn), so the
  fork's concern — remounting `ChatView` before the optimistic first prompt is durable — is
  subsumed. Upstream's version additionally promotes on a startup failure with no user message, so
  the canonical route can render the startup error instead of the draft hanging forever. The helper,
  its three unit tests, and its `_chat.draft.$draftId.tsx` call site were all deleted; the fork's
  `outsideMachineScope` guards in that route were preserved.
- **New timeline row kind `thinking`** (upstream #8984, "keep agent activity visible between
  actions") joined the `MessagesTimelineRow` union. The fork's in-chat find has an exhaustive
  `switch (row.kind)` in `apps/web/src/components/chat/chatSearch.ts` — `thinking` was folded in
  next to `working` as a text-less live status row. **Any future upstream row kind will break this
  switch the same way; that is the intended tripwire, so add the case rather than a `default`.**
- **`ChatComposer` slash menu:** upstream added `slashCommandItemsForPromptPosition(items,
isAtPromptStart)`. The fork's `/fork` item now goes _inside_ that call's item array (the helper
  only filters `type === "skill"`, so wrapping `/fork` is a no-op today but keeps the fork item on
  the same code path).
- **`ServerEnvironment.ts`:** upstream split identity acquisition into `makeIdentity`. The fork's
  `resolveServerVersion` export (payload-aware `T3CODE_SERVER_VERSION` override) sits above it
  untouched and is still consumed by the descriptor's `serverVersion`.
- **`ChatView.tsx` send path:** upstream deleted the `beginLocalDispatch({ preparingWorktree: false
})` call before `backgroundThreadRef` (worktree status now stays visible via the new
  `isPreparingWorktree` prop on `MessagesTimeline`). Git aligned that deletion against the fork's
  `shouldQueuePrompt` branch; the resolution keeps the fork's queue/else split and drops the line
  from the else arm only. The two other `preparingWorktree: false` dispatches are upstream's and
  stay.
- **`CHAT_LIST_ANCHOR_OFFSET` moved** from `@t3tools/shared/chatList` to
  `CHAT_TIMELINE_ANCHOR_OFFSET` in `./chat/timelineScrollAnchoring`.
- **New mobile deps** (`expo-video`, `expo-document-picker`) — `vp i` is required after this merge
  or `apps/mobile` typecheck fails with TS2307.
- **CI/workflows did not conflict** this window; `git diff f3e7062ba HEAD -- .github/workflows` is
  empty and only `ci.yml` + `release.yml` are present.
- Upstream deleted the root `app.json` (#8934); the fork carries no divergence there.

## 2026-08-31 upstream merge (upstream ships file attachments, plan chips reverted) — migration notes

Merged `upstream/main` through `e9c4775e8` (96 commits). The headline is that **upstream
implemented arbitrary file attachments itself** (#8235 server, #8236 web, #8237 mobile), so a
long-standing fork divergence was retired rather than re-applied.

- **No migrations arrived.** Upstream is still at its 043; the fork's renumbered 044–046 are
  untouched. Fork's next free id is still **47**.
- **The fork's arbitrary-file-attachment stack was retired in favour of upstream's**, which is a
  strict superset (real 50MB upload channel, video playback, needs-reattach markers, an _open_
  `ChatAttachment` union with an unknown-type passthrough). Concretely removed: the widened
  `ComposerImageAttachment`/`ComposerAttachment` union alias in `composerDraftStore.ts` (upstream's
  separate `ComposerImageAttachment` + `ComposerFileAttachment` interfaces are back), the inline
  `UploadChatFileAttachment` contract schema, the fork's `isImageFile`/`ATTACHMENT_SIZE_LIMIT_LABEL`
  composer branch, `AttachmentPathDescriptor` + the prefix-scan `resolveAttachmentPathById`, and
  `inferAttachmentExtension` in `imageMime.ts` (upstream's `attachmentFileExtension` replaces it).
  **The fork's `thread.prompt.queue` widening to `Schema.Union([UploadChatAttachment, ChatAttachment])`
  was kept** — queued prompts still need to carry uploaded attachments.
- **Attachment ids now carry their file extension.** Upstream's `resolveAttachmentPathById` reads the
  extension back off the id (`createAttachmentId(threadId, ext)`) and only _probes_ image extensions
  as a fallback. Two fork call sites minted extension-less ids and would have become unresolvable:
  `threadContextArtifact.ts` (the `.md` transcript behind thread forking) and `Normalizer.ts`'s
  inline data-URL path. Both now pass an extension. **Any new `createAttachmentId` call for a
  non-image must do the same.**
- **Attachment type guards, not literal comparisons.** The union has an open member, so
  `attachment.type === "image"` no longer narrows. Use `isImageAttachment` / `isFileAttachment`
  from `apps/web/src/types.ts`.
- **Upstream reverted its own turn-plan chips** (#8734 reverted #5558), so `TurnPlanEntry`,
  the `turn-plan` timeline row, `TurnPlanTimelineRow`, the `deriveTimelineEntries` `turnPlans`
  parameter, and the `chatSearch` `turn-plan` case are all gone. Plans now render via
  `deriveActivePlanState`. The fork's **`user-input` row survives** alongside — when resolving these
  files, keep `UserInputExchange`/`UserInputAnswerTimelineRow` and drop anything plan-shaped.
- **`ProviderSettingsPanel.tsx` and `ProviderInstanceCard.tsx` were taken wholesale and the fork
  pieces re-applied.** Upstream split provider settings into a list + editor with
  `renderProviderInstance(row, mode)` and gave the card configuration/models tabs. The fork's
  **"Default traits"** feature (`providerModelDefaults`, `defaultModelOptions`,
  `onDefaultModelOptionsChange`, the `planModeEnabled={false}` `TraitsPicker`) now lives at the top
  of the card's **models tab**. Redo it this way if these conflict again.
- **`Sidebar.tsx`: the project picker is now a searchable `Combobox`** (#5931) driven by a
  `projectScopeMenuState` reducer, so the fork's `projectScopeMenuOpen` state is gone. The fork's
  per-project todo button moved inside upstream's `ComboboxItem` (guarded by `project ?`) and closes
  the popup with `dispatchProjectScopeMenu({ type: "open-changed", open: false })`. The scoped
  project-todo tooltip button was re-applied after `</Combobox>`.
- **Mobile: `useThemeColor` is gone.** Upstream's Uniwind theme refactor (#7327) replaced CSS-variable
  subscription with `useUniwindTheme()`, which returns the whole palette keyed by variable name; git
  detected the fork's `lib/useThemeColor.ts` as renamed into upstream's `lib/useUniwindTheme.ts` and
  deleted it. `useUniwindTheme()["--color-icon"]` is the direct replacement. `MachineSwitcher.tsx`
  tints native `SymbolView` icons, so it was added to `THEME_INTEROP_ALLOWLIST` in
  `oxlint-plugin-t3code/rules/no-mobile-uniwind-theme-escape-hatches.ts` — that rule is a hard
  **error**, not a warning.
- **`makeManagedServerProvider`: both gates kept, in order.** Upstream's
  `checkProviderOnSettingsChange` early-return runs first (it can skip the probe entirely), then the
  fork's `providerCheckCache` invalidate + `Cache.get`. Upstream's uncached
  `const nextSnapshot = yield* input.checkProvider` was dropped as the duplicate.
- **`ClaudeAdapter`: the fork's attachment `kind` switch was kept, upstream's image-only `continue`
  was not.** Claude ingests PDFs as document blocks and text files inline, which upstream's
  path-line-in-the-prompt fallback does not do. The loop now skips anything that is neither `image`
  nor `file` (the union is open). Upstream's `normalizeClaudeContextUsageApiSnapshot` deletion
  (#8610) was adopted.
- **`ClaudeAdapter` usage semantics diverge deliberately.** The fork gates `maxTokens` on
  `contextAccurate`: accumulated request totals (`result.usage` input+output) overcount the live
  window, so the quota meter must not pair them with the context window. Upstream's new
  "completes with result usage without querying current context usage" test asserted
  `maxTokens: 200000`; that expectation was dropped (with a comment). Its real subject —
  `getContextUsageCalls === 0` — still passes.
- **Retired fork tests:** two `composerDraftStore.test.ts` tests asserting files land in
  `draft.images`, and `thread-work-log.tsx`'s unused `visibleWorkLogActivities` (the same filter now
  lives in `lib/threadActivity.ts`). `hydrateImagesFromPersisted` gained a `mimeType.startsWith("image/")`
  guard so a draft persisted by an older fork build drops its stale non-image entry instead of
  hydrating a broken image chip; its test now asserts that.
- **Two known environment-only macOS failures** (both verified against a pristine `upstream/main`
  worktree, neither caused by the merge):
  - `apps/server/src/entrypoint.test.ts` > "matches through a symlinked entrypoint" — `os.tmpdir()`
    is itself a symlink on macOS.
  - `scripts/build-desktop-artifact.test.ts` > "skips the primary native probe for
    cross-architecture Windows payloads" — on Apple Silicon the host arch _equals_ the `arm64`
    target, so the cross-arch precondition never holds. Passes on x64 CI.
- `.github/workflows` is byte-identical to the pre-merge fork tip and still holds only `ci.yml` +
  `release.yml`. No upstream-only workflows arrived this window except
  `desktop-macos-preview.yml`, which was dropped again.
- `effect` stayed on beta.103, so the fork patch did not need re-deriving. `pnpm-lock.yaml` was
  regenerated from the merged manifests.
- Fork package versions stay on the `0.0.25-amit` marker (upstream is at `0.0.37`).

## 2026-08-26 upstream merge (attachment uploads, tool-activity collapse, PR surfaces) — migration notes

Merged `upstream/main` through `a3a8cbd60` (307 commits). Notable integrations:

- **Migration renumbering held again.** Upstream added 041–043; fork ids 33–43 are frozen,
  so upstream's became **044–046** (`AuthSessionClientConnection`,
  `ProjectionThreadLinkedPullRequest`, `ProjectionThreadsUnsettledAt`), with the two
  renamed `.test.ts` `layer(...)` labels and their `toMigrationInclusive` bounds repointed
  (43/44 and 44/45). Fork's next free id is **47**.
- **`ChatComposer.tsx` and `MessagesTimeline.tsx` were taken wholesale and the fork
  pieces re-applied on top** — reconciling 12 and 10 interleaved conflicts in place was
  not viable. Re-applied in the composer: the `RateLimitMeter` wiring (import,
  `useAccountRateLimitSnapshot`, the `activeRateLimits` prop on
  `ComposerFooterPrimaryActions` and both render sites), `shouldApplyProviderModelDefaults`
  on `useEffectiveComposerModelState`, the `/fork` slash item + handler, the
  `isImageFile`/`ATTACHMENT_SIZE_LIMIT_LABEL` file-attachment path (acceptance, unfiltered
  paste, name+MIME chip), and the `phase === "running"` "Queue message" collapsed label.
  Re-applied in the timeline: `TimelineSearchCtx` + `{searchBar}` + `setTimelineHostElement`
  - `data-chat-scroll-container`, the `searchExpanded` threading (row → `WorkGroupSection`
    → `SimpleWorkEntryRow` → `PlainWorkEntryRow` → `CollapsibleUserMessageBody`), the
    `user-input` row branch, the generated-image button, `loading="lazy"`, and the
    `buildToolCallExpandedBody` dedupe. **If either file conflicts heavily again, redo it
    this way rather than merging hunk by hunk.**
- **Upstream's attachment upload channel is image-only, so the fork's arbitrary file
  attachments now take two paths.** `AttachmentCreateUploadUrlInput.mimeType` is a literal
  union of image MIME types, so `ChatView`'s send path splits
  `uploadableComposerImages` (images → mint/upload/`getUploadedAttachments`) from
  non-images, which keep riding the inline `dataUrl` path. `thread.prompt.queue` was
  widened to `Schema.Union([UploadChatAttachment, ChatAttachment])` (mirroring
  `thread.turn.start`) so a queued prompt can carry uploaded attachments; the server
  normalizer already handled both shapes. `getUploadedAttachments` still hardcodes
  `type: "image"` — widening the upload channel to files is the follow-up if the inline
  path ever needs to go away.
- **`session-logic` tool detail: upstream converged past the fork, with the fork's
  fallbacks kept.** Upstream's `extractToolOutput` (PR "show command output in work log")
  now supplies the detail for command rows; the fork's `summarizeFailedCommandExit` is the
  fallback when a command produced no usable output, and the fork's path/read-size logic
  (`summarizeReadContentSize`, `classifyToolActivityAction`) still handles read/file-change
  rows. Three fork tests were rewritten to the merged semantics (output wins, exit code
  only when silent).
- **`serverRuntimeStartup.ts` is upstream's again.** Upstream's `reconcileProviderSessions`
  (orphaned starting/running sessions → `error`, `activeTurnId` cleared, directory binding
  payload cleared) is a strict superset of the fork's
  `reconcileStoppedProviderSessionProjections` at startup, and the two together broke
  upstream's `orphanedProviderSessionStartup.integration.test.ts` (the fork pass marked the
  thread `stopped` first, so the orphan pass skipped it). The fork function, its phase, and
  its unit test were deleted. Do not re-add a second startup reconciler.
- **`ProviderCommandReactor` interrupt: upstream's version adopted.** Interrupts now go out
  by session (no `turnId` — orchestration turn ids are not provider turn ids) and carry
  upstream's failure recovery (stop session, record `provider.turn.interrupt.failed`). The
  fork test that asserted the `turnId` argument was updated.
- **`ComposerPendingUserInputPanel` was taken wholesale.** Upstream's collapse-from-header
  `Collapsible` replaced the fork's collapse/dismiss controls, so the fork's
  `pendingUserInputPanelState` machinery in `ChatComposer` and the "Questions" restore
  button are **gone**. The panel now takes only
  `pendingUserInputs`/`respondingRequestIds`/`answers`/`questionIndex`/`onToggleOption`/`onAdvance`.
- **`threadActionMenu.logic.ts`: fork items merged into upstream's nested structure.**
  Upstream moved the copy actions into a `copy` submenu and added `archive`, so
  `copy-thread-ref` is now a **child of `copy`**, `fork` sits after `rename`, and
  `export-zip` stays top-level before `archive`. `threadActionMenu.logic.test.ts` asserts
  the exact top-level id list — update it whenever an item moves.
- **`ComposerPrimaryActions`: the fork's Queue-while-running branch wins.** Upstream added
  `showSendWhileRunning` (a mobile-only send button beside Stop) whose tail branch is
  unreachable behind the fork's early `if (isRunning)` return. The Queue button gained
  `aria-label="Queue message"` and upstream's two running-state tests were rewritten to
  assert the fork affordance.
- **`desktopUpdate.logic`: the fork's installer semantics kept.** The `in-place` branch is
  unchanged; the installer branch keeps the fork's "auto-download, apply on one click"
  shape (upstream's `status === "available" → download` clause and its
  "prefers a newly available release" test were dropped, since the fork never emits
  `kind: "installer"`). `getDesktopUpdateInstallConfirmationMessage` keeps its `platform`
  parameter and the A2 Code / Windows-install copy.
- **`apps/desktop/resources/icon.{png,ico,icns}` were deleted** with upstream: icons are
  generated from `assets/<brand>/` (`BRAND_ASSET_PATHS`) into the staged resources dir, and
  `DesktopAssets` prefers the source-tree brand asset. The fork's branded `assets/prod`
  files are unaffected. `scripts/build-desktop-artifact.ts` keeps `A2 Code` for the Linux
  protocol name and product name (upstream's literals came back in this merge — the tests
  at the DMG title and Linux protocol assertions are the tripwires).
- **`DesktopEnvironment`: upstream added `serverRoot`** (packaged Windows resolves the
  server tree from `resources/server.asar`). The fork's `bundledBackendEntryPath` now
  derives from `serverRoot`, not `appRoot`, so the payload fallback points at the same tree
  as `backendEntryPath`.
- **`DesktopUpdates.{ts,test.ts}` stayed the fork's** (payload-only facade). Upstream's
  update in this window was entirely electron-installer internals
  (`activeUpdateActionRef`, channel-change guards); per the payload feature notes it was
  not re-wired.
- **Mobile: upstream replaced the grouped sidebar-header pill.** `ThreadNavigationSidebar`'s
  header is now upstream's flat `flex-row items-center gap-2.5` row, so `MachineSwitcher`
  renders ungrouped there (the local `SidebarHeaderButtonGroup` and the `grouped` props are
  gone). `sortThreadsForListV2` now sorts pinned block → upstream's
  `activeThreadAnchorTimestampMs` → id, and its type parameter carries both `pinnedAt` and
  `unsettledAt`.
- **`SidebarChrome` adopted upstream's `hidden … md:flex` brand-link classes** on the fork's
  branded (`AppWordmark` + `APP_NAME_SUFFIX` + version tooltip) link;
  `threadSidebarWidth.test.ts` greps the file for that exact class string. The dead
  `sidebar-brand` class was dropped.
- **Upstream-only workflows keep arriving.** `desktop-macos-preview.yml`, `publish-aur.yml`,
  and `mobile-showcase-screenshots.yml` were dropped. `.github/workflows` is byte-identical
  to the pre-merge fork tip and still holds only `ci.yml` + `release.yml`.
- **Test fixtures needed the other side's fields, as always:** `forkedFromId: null` in
  upstream's `ProjectionRepositories.test.ts` linked-PR row, `isExpandedToolGroupEntry` /
  `isLastExpandedToolGroupEntry` in the fork's `chatSearch.test.ts` work row, and
  `planModeEnabled={false}` on `ProviderInstanceCard`'s defaults `TraitsPicker` (upstream
  made the prop required). `chatSearch.ts.getRowSearchText` gained a `work-live` case and
  now returns the `work-toggle` summary — that switch is still the first thing to break on
  a new row kind.
- **Known environment-only failure:** `apps/server/src/entrypoint.test.ts` >
  "matches through a symlinked entrypoint" fails on macOS because `os.tmpdir()` is itself a
  symlink (`/var` → `/private/var`), so `realpathSync` never equals the unresolved module
  URL. The file is byte-identical to upstream; it passes on Linux CI.
- `effect` stayed on beta.103, so the fork patch did not need re-deriving. `pnpm-lock.yaml`
  was regenerated (the fork's `effect` patch hash differs from upstream's).
- Fork package versions stay on the `0.0.25-amit` marker (upstream is at `0.0.34`).

## 2026-08-24 project-tree sidebar restored as the primary layout

The fork reversed upstream's sidebar promotion. The original per-project tree is
again the default and the flat active/settled list is optional.

- `packages/contracts/src/settings.ts` defaults `legacySidebarEnabled` to `true`.
  The old field name remains part of the persisted schema so existing settings files
  keep working. Do not rename or invert it during an upstream merge without adding a
  settings migration. An explicit `false` still selects the flat list.
- `apps/web/src/hooks/useSettings.ts` keeps the compatibility-named
  `useLegacySidebarEnabled()` hook because its callers already encode the two layout
  branches. `resolveProjectTreeSidebarEnabled()` returns `true` before client settings
  hydrate, then uses the persisted value. This prevents every program restart from
  mounting the flat list before switching to the project tree.
- `apps/web/src/components/settings/SettingsPanels.tsx` exposes the choice as
  "Project tree sidebar" in the main General section, not under Legacy features.
  `apps/web/src/components/settings/settingsSearch.ts` uses the matching
  `project-tree-sidebar` search id and label.
- `apps/web/src/components/AppSidebarLayout.tsx` still renders
  `LegacyThreadSidebar` when the hook returns `true`. The component and hook names are
  now implementation-history names, not product labels. Preserve this branch direction
  unless the internal files are renamed together.

## 2026-08-14 upstream merge (sidebar v2 promoted to default, turn plan chips, PR surfaces) — migration notes

Merged `upstream/main` through `7e01d33f0` (206 commits). Notable integrations:

- **The sidebar files were RENAMED and git did not detect it.** Upstream's
  `0de954073` made sidebar v2 the default: v1 `Sidebar.tsx` → **`LegacySidebar.tsx`**
  and `SidebarV2.tsx` → **`Sidebar.tsx`** (`SidebarV2.tsx` deleted). Git therefore
  diffed the fork's _v1_ `Sidebar.tsx` against upstream's _v2_-derived `Sidebar.tsx`
  (20 bogus conflicts) and reported `SidebarV2.tsx` as modify/delete. **Resolution:
  two hand-run 3-way merges with `git merge-file`**, which is the technique to reuse
  if upstream ever reshuffles these files again:
  - `Sidebar.tsx` = merge(base `SidebarV2.tsx`, fork `SidebarV2.tsx`, upstream `Sidebar.tsx`)
  - `LegacySidebar.tsx` = merge(base `Sidebar.tsx`, fork `Sidebar.tsx`, upstream `LegacySidebar.tsx`)
    The project-tree sidebar is the fork's primary layout and remains selected through
    the compatibility-named `useLegacySidebarEnabled()`, so both files carry fork behavior.
- **Fork thread actions were promoted into the shared menu builder.** The fork's
  `Fork thread`, `Copy thread ref`, and `Export thread (zip)` items lived only in the
  v1 sidebar, so the rename would have silently removed them from the default surface.
  They now live in upstream's `apps/web/src/components/threadActionMenu.logic.ts`
  (`ThreadActionMenuId` + `buildThreadActionMenuItems`) and are handled in **both**
  consumers — `Sidebar.tsx` (`handleThreadContextMenu`) and
  `apps/web/src/hooks/useThreadActionMenu.ts` (the chat header menu). Adding a fork
  action to that builder without handling it in both places makes it a no-op in one
  surface; `threadActionMenu.logic.test.ts` asserts the exact id list.
- **Migration renumbering held again.** Upstream added 037–040; fork ids 33–38 are
  frozen, so upstream's became **039–042** (`ProjectionTurnsKeysetIndex`,
  `ProjectionThreadsPinOrderKey`, `ProjectionProjectsDefaultThreadEnvMode`,
  `ProjectionProjectFaviconPath`), with the favicon test's `layer(...)` label and its
  `toMigrationInclusive` bounds (41/42) repointed. (Superseded: the fork's next free id is
  now **47** — see the 2026-08-26 notes.)
- **`turn-plan` timeline rows are a new row kind — every switch over rows needs a
  case.** Upstream added `deriveTurnPlans`/`TurnPlanEntry` and a `turn-plan`
  `TimelineEntry`/`MessagesTimelineRow` variant beside the fork's `user-input` variant.
  `deriveTimelineEntries` now takes **both** `turnPlans` and `userInputExchanges`
  (turn plans first), and `chatSearch.ts.getRowSearchText` gained a `turn-plan` case
  (indexes the plan step text) — that switch is exhaustive and is the first thing to
  break on a new row kind.
- **`MessagesTimeline` list internals were reworked; the search wiring was re-applied
  on top.** Upstream added `liveFollowEnabled`/`TIMELINE_MAINTAIN_SCROLL_AT_END`, a
  `maintainVisibleContentPosition` const (now `size: true` + `restore: true`), and a
  `TimelineLoadEarlierHeader`. The fork's `TimelineSearchCtx` wrapper, `{searchBar}`,
  `setTimelineHostElement` ref, and `data-chat-scroll-container` were re-wrapped
  around upstream's list.
- **Live-follow: upstream converged past the fork on both platforms.**
  - Web: the fork's `timelineInteractionSurface` listener effect was replaced by
    upstream's scroll-node opt-out listeners (direction-aware wheel, end-band touch,
    scrollbar-vs-content pointerdown, keyboard). The fork's state + `ref=` were removed.
  - Mobile: the fork's `05c89bac8` follow latch was replaced by upstream's extracted,
    unit-tested `thread-feed-live-follow.ts` state machine (`ThreadFeed.tsx` taken
    wholesale). Do not re-introduce a local latch.
- **Thread error banner: upstream converged (`57b105267`).** The fork's
  `dismissedServerErrorsByThreadKey` map was replaced by upstream's session-scoped
  mask (`getThreadErrorBannerKey` / `shouldShowThreadErrorBanner` /
  `dismissThreadErrorBannerForSession` + a dismiss tick), which also survives
  reconnects. `rawServerError` and the fork's clearing effect are gone.
- **`apps/server/vite.config.ts`: upstream converged past the fork.** The fork's local
  inverted `shouldBundleCliDependency` was superseded by upstream's shared
  `scripts/lib/cli-external-packages.ts` (`CLI_RUNTIME_EXTERNAL_PREFIXES` +
  `isExternalCliDependency`), which both the bundler and `build-desktop-artifact.ts`
  derive from. Upstream also stopped unpacking `node_modules` wholesale from the
  Windows asar, so keep deriving from that one list rather than re-adding a local one.
- **`SidebarUpdatePill` became a compact icon button in the sidebar footer, and
  `SidebarUpdateArchitectureWarning` split out.** Upstream's structure was taken
  wholesale, then the fork's **single-click apply with no confirmation** was
  re-applied (upstream's `dialogs.confirm` block deleted, `result.requiresRelaunch`
  guard restored, `handleAction` back to non-async). The fork's local
  `downloadProgress` was dropped as redundant — `getDesktopUpdateButtonTooltip`
  already formats it.
- **`ProviderSettingsPanel` was extracted out of `SettingsPanels.tsx`.** Upstream's
  new `apps/web/src/components/settings/ProviderSettingsPanel.tsx` is now the home of
  the fork's **`providerModelDefaults`** wiring (the `isDirty` check, the
  `updateProviderModelDefaults` setter, the delete/reset cleanups, and the
  `defaultModelOptions`/`onDefaultModelOptionsChange` card props). That feature is
  fork-only end to end (contracts, `composerDraftStore`, `ProviderInstanceCard`) —
  only the panel wiring needed re-homing. `SettingsPanels.tsx` was taken wholesale and
  only the fork's dual-version `AboutVersionTitle` + `primaryServerConfigAtom` were
  re-applied; the fork's "A2 Code" theme-row copy is gone because upstream replaced
  that row with `ThemeLibrary`.
- **`DesktopBridge.confirm` was removed upstream** (it survives on `LocalApi` with
  options). The fork's `getPathForFile` sits beside upstream's new `pickThemeFiles`
  in both `preload.ts` and `packages/contracts/src/ipc.ts`.
- **`markThreadUnread` is fork-narrowed to one argument** (the fork's explicit
  `unreadThreadIds` flag replaced the timestamp form). Upstream's new
  `useThreadActionMenu.ts` and its own multi-select handler both passed
  `thread.latestTurn?.completedAt`; drop that argument wherever it reappears.
- **`ChatView` gained a read-only environment _indicator_, which is not the
  fork-removed environment _picker_.** Upstream's `logicalProjectEnvironments` /
  `showComposerEnvironmentIndicator` block is required (consumed by the composer), and
  `useProjects` had to be imported. The fork's duplicate `projectGroupingSettings`
  line was dropped, and the fork's early `activeThreadLastVisitedAt` was renamed to
  `routeThreadLastVisitedAt` to avoid colliding with upstream's `activeThreadKey`-keyed
  declaration further down the same function.
- **Upstream-only workflows keep arriving.** `mobile-fingerprint-check.yml`,
  `thread-transfer-report.yml`, and `web-preview.yml` were dropped (as was
  `mobile-eas-production.yml` again). `.github/workflows` is byte-identical to the
  pre-merge fork tip and still holds only `ci.yml` + `release.yml`.
- **Test fixtures needed the other side's fields, as always:** `queuedPrompts: []` in
  upstream's `threads-pagination.test.ts`; `providerModelDefaults` in upstream's
  `ProviderSettingsPanel.environment.test.tsx` delete/reset assertions;
  `turn-plan`-aware ids in `threadActionMenu.logic.test.ts`; and upstream's
  `maintain-visible-content-position-size="true"`/`-restore="true"` in
  `MessagesTimeline.test.tsx` (alongside the fork's `loading="lazy"` assertions).
  `scripts/build-desktop-artifact.test.ts` also merged duplicate `FileSystem`/`Path`
  imports — grep new test files for TS2300 after a merge.
- **`effect` stayed on beta.103, so the patch did not need re-deriving** this time.
  Verified `patches/effect@4.0.0-beta.103.patch` still touches `dist/Schema.js`,
  `dist/Schema.d.ts`, and `src/Schema.ts` on top of upstream's `McpServer`/`RpcClient`
  hunks.
- Fork package versions stay on the `0.0.25-amit` marker (upstream is at `0.0.33`).

## 2026-08-06 upstream merge (upstream thread pinning, libghostty terminals, Linux startup) — migration notes

Merged `upstream/main` through `a2ca89aa1` (86 commits). Notable integrations:

- **Upstream landed its own thread pinning — the fork's converged onto it.**
  Upstream added `036_ProjectionThreadsPinned` with the _same_ `pinned_at`
  column the fork's `035_ProjectionThreadsPinnedAt` already adds, plus a
  `threadPinning` environment capability and first-class `thread.pin` /
  `thread.unpin` commands. Resolution: upstream's duplicate migration was
  **deleted** rather than renumbered (a renumbered copy would be a pure no-op on
  every DB, fork or fresh); fork ids 33–38 are unchanged and 39 is the next free
  id. Both sides declared `pinnedAt` in the same object literals across
  contracts, `ProjectionPipeline`, `ProjectionSnapshotQuery`,
  `Services/ProjectionThreads`, and the `Layers/ProjectionThreads` SQL —
  git merged them additively, producing duplicate keys/columns (TS1117, and a
  genuinely broken INSERT). **After any future merge that touches thread
  metadata, grep the projection layer for duplicated field names.**
  - Web: upstream's `pinThread`/`unpinThread` and the fork's `setThreadPinned`
    (via `thread.meta.update`) both survive in `useThreadActions.ts`. `SidebarV2`
    uses upstream's; the fork's v1 `Sidebar.tsx` still uses `setThreadPinned`.
    Both converge on the same column. Collapsing v1 onto `pinThread`/`unpinThread`
    is a cleanup worth doing next time `Sidebar.tsx` is touched.
  - Mobile: the fork's pin surface was **dropped** in favour of upstream's
    (`thread-list-v2-items.tsx` was taken wholesale; `useThreadListActions`
    exposes upstream's `pinThread`/`unpinThread`; `AppSymbol`'s fork-only
    `pin.fill` entry is gone). The fork-only **v1** rows still take a single
    `onTogglePinThread`, now derived locally from upstream's two actions in
    `HomeScreen.tsx` and `ThreadNavigationSidebar.tsx`.
- **Bounded thread replay: upstream fully converged (`ca72e381c`).** Upstream's
  thread-detail catch-up now computes the gap against
  `orchestrationEngine.latestSequence` and falls back to a fresh snapshot past
  `THREAD_RESUME_MAX_GAP`, which is a strictly better form of the fork's bounded
  `readEvents(afterSequence)`. **The fork's divergence in `ws.ts` is retired** —
  both subscription paths are now upstream's. Do not re-introduce
  `Number.MAX_SAFE_INTEGER` replay.
- **Renderer-crash recovery: upstream converged too (`36caf34c6`).** The fork's
  escalating-backoff `scheduleRendererGoneRecovery` was replaced by upstream's
  bounded recovery (500 ms reload, max 3 attempts per rolling 60 s). The fork's
  exported, tested `isRecoverableMainRendererGoneReason` predicate was kept in
  place of upstream's narrower inline `crashed|oom|abnormal-exit` check, so
  `memory-eviction`/`launch-failed`/`killed` still recover.
- **Desktop state paths moved into a new upstream module.** Upstream extracted
  `resolveDesktopBaseDir`/`resolveDesktopStateDir` into
  `apps/desktop/src/app/DesktopStatePaths.ts`, which **hardcodes `~/.t3`** — it
  was repointed at the fork's `.a2code`. Upstream's new
  `DesktopEarlyElectronStartup.ts` (Linux secret-storage backend, `6f04a5cff`)
  likewise hardcodes `linuxWmClass: "t3code(-dev)"`; repointed at `a2code(-dev)`
  so it matches `DesktopEnvironment`, and its tests repointed off `.t3`.
  `DesktopEnvironment` keeps the fork's `a2code` / `A2 Code` dir names on top of
  upstream's new helpers, `xdgDataHome` applications dir, and `appImagePath`.
- **Mobile `repositoryGroups.ts` deleted upstream (`47dfc6526`).** The fork's
  `NewTaskRouteScreen` grouping already runs through upstream's `projectScopes`
  from `new-task-flow-provider` (which is machine-scoped via
  `useMachineProjects`), so the fork's `groupProjectsByRepository` import and its
  test were dropped. Machine scoping (`useMachineProjects`,
  `useWorkspaceState(machineEnvironmentId)`) survives in both new-task screens,
  and `mobile-preferences` carries both `machineEnvironmentId` and upstream's
  `projectGroupingMode`.
- **`effect` patch re-derived again**, as expected on every bump (beta.102 →
  beta.103). Verified the committed patch touches `dist/Schema.js`,
  `dist/Schema.d.ts`, and `src/Schema.ts` in addition to upstream's
  `McpServer`/`RpcClient` hunks.
- **`SimpleWorkEntryRow` was split upstream** into a dispatcher plus
  `PlainWorkEntryRow` (agent-spawn CTA rows). The fork's in-chat-find
  `searchExpanded` prop is threaded through both halves — re-apply if a future
  merge re-splits that component.
- **Settings rows are now search-indexed** (`e5c754706`): upstream replaced the
  literal `title="…"` prop with `{...searchableSetting("theme")}`. The fork's
  "A2 Code" copy lives in `description`, which is unaffected.
- Test fixtures needed the other side's fields again: `queuedPrompts: []` in
  upstream's `decider.pinned.test.ts`, and `kind`/`shellVersion` in the fork's
  `desktopUpdate.toast.test.tsx` `DesktopUpdateState` fixture.
- Fork package versions stay on the `0.0.25-amit` marker (upstream is at
  `0.0.32`).

## 2026-08-01 fork feature (mobile machine-scoped environment selector) — merge notes

The mobile app now mirrors the web fork's persisted, machine-wide environment
selector. The active environment is selected from the mobile home/sidebar
switcher and scopes the workspace, new-task defaults, project creation, and
pending-task presentation. Switching machines keeps existing thread runtime
ownership intact; on split layouts, a thread route from the previous machine
returns to Home. Queued outbox delivery remains intentionally unscoped so
background work for another machine is not stranded.

- **Shared selection logic:** `packages/client-runtime/src/state/machineScope.ts`
  owns the fallback resolver and scope predicate; the web and mobile state
  layers retain platform-specific persistence and atoms.
- **Mobile selection and persistence:** `apps/mobile/src/state/machineScope.ts`
  resolves the registered machine and gives the current in-memory selection
  precedence over the older persisted value, so a tap updates the UI
  immediately while the preference write completes. `apps/mobile/src/state/environments.ts`
  exposes the hook/setter, and `apps/mobile/src/persistence/mobile-preferences.ts`
  persists `machineEnvironmentId`.
- **Scoped projections and status:** `apps/mobile/src/state/entities.ts` filters
  projects and thread shells, `apps/mobile/src/state/workspace.ts` projects
  connection/snapshot status for the selected environment, and
  `apps/mobile/src/state/use-pending-new-tasks.ts` filters queued task
  presentation. Outbox draining remains deliberately global.
- **Switcher and Android interaction:** `apps/mobile/src/components/MachineSwitcher.tsx`
  owns the shared switcher and native iOS menu item.
  `apps/mobile/src/components/AndroidAnchoredMenu.tsx` attaches the open callback
  directly to a valid visible child press target on Android; keep this instead
  of restoring the nested wrapper-only press path, which can make a visible
  trigger appear inert.
- **Home and sidebar UI:** `apps/mobile/src/features/home/HomeHeader.tsx`,
  `HomeRouteScreen.tsx`, and `home-list-filter-menu.ts`, plus
  `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` and
  `sidebar-native-header-items.ts`. The old per-screen environment filter is
  excluded because the machine switcher owns that scope.
- **Project/new-task flows:** `apps/mobile/src/features/projects/AddProjectScreen.tsx`,
  `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx`,
  `NewTaskDraftScreen.tsx`, and `new-task-flow-provider.tsx` only expose the
  selected machine's projects and use that machine for new-task defaults.
- **Navigation:** `apps/mobile/src/features/layout/AdaptiveWorkspaceLayout.tsx`
  replaces an open split-layout thread route with Home when the user selects a
  different machine.
- **Known strict-isolation gaps:** mobile thread/detail routes do not yet reject
  route parameters outside the selected machine, so a restored navigation state
  or deep link can still open another machine's thread. In addition,
  `useMachineProjects`, `useMachineThreadShells`, pending-task filtering, and
  search deliberately fail open while `machineEnvironmentId` is `null`; during
  that unresolved window they can consider every environment. Do not describe
  mobile as enforcing a strict selected-machine boundary until route guards and
  fail-closed unresolved-state behavior are added and covered by a multi-environment
  integration test.
- **Merge hotspots:** preserve the machine scope when upstream changes mobile
  connection catalogs, home/sidebar filtering, workspace status, project
  creation, new-task environment selection, Android anchored-menu triggers, or
  thread route handling. Do not scope the outbox drain or other background
  runtime collections to the selected machine.

## 2026-08-01 fork feature (provider health-check cache) — merge notes

`apps/server/src/provider/makeManagedServerProvider.ts` caches a successful
provider check for 24 hours so periodic background maintenance does not
repeatedly launch agent processes or re-read their protected application data.
Failed checks are not cached, changed settings invalidate the entry, and an
explicit user refresh bypasses the cache. Preserve the distinction between a
periodic cached refresh and an explicit uncached refresh when upstream changes
provider maintenance scheduling. Tests live in
`apps/server/src/provider/makeManagedServerProvider.test.ts`.

## 2026-08-01 fork feature (machine-scoped environment selector) — merge notes

The web UI now has a persisted, machine-wide environment selector. The active
environment is selected once from `MachineSwitcher` in the sidebar, and the
sidebar, landing page, command palette, project creation flow, and new-thread
defaults only expose projects and threads from that environment. Switching
environments leaves a project route that belongs to the previous environment.
The per-thread environment picker was removed from `ChatView`; project/thread
records still retain their underlying `environmentId` associations.

- **State and selector:** `apps/web/src/state/machineScope.ts` owns the
  persisted selection (`t3code:machine-scope:v1`), fallback resolution, and
  `apps/web/src/components/sidebar/MachineSwitcher.tsx` owns the sidebar UI.
  `apps/web/src/state/environments.ts` exposes the shared hook/setter.
- **Scoped projections:** `apps/web/src/state/entities.ts` provides
  machine-scoped project and thread-shell hooks. `Sidebar.tsx`, `SidebarV2.tsx`,
  `_chat.tsx`, `_chat.index.tsx`, `CommandPalette.tsx`,
  `DraftHeroHeadline.tsx`, and `useHandleNewThread.ts` consume these hooks.
- **Merge hotspots:** preserve the selector and scoped projections when
  upstream changes environment catalogs, route handling, sidebar grouping,
  project/thread aggregation, new-thread defaults, or `ChatView`/
  `BranchToolbar` environment controls. Reconcile those files additively;
  accepting upstream versions wholesale would restore cross-machine projects
  or the per-thread environment prompt.

## 2026-08-01 fork feature (environment-scoped provider usage) — merge notes

Provider quota snapshots are now isolated by the pair
`environmentId + providerInstanceId`. The web client filters live rate-limit
activities to the active environment and persists snapshots under the same
composite key, so identically named GPT/Codex or Claude instances on two
machines cannot overwrite or display each other's counters. The old
instance-only browser cache is invalidated by the store version bump.

- **Web state:** `apps/web/src/state/rateLimits.ts`,
  `apps/web/src/lib/useAccountRateLimitSnapshot.ts`, and
  `apps/web/src/rateLimitSnapshotStore.ts` are the main conflict seams. Keep
  the environment dimension in both live activity selection and persistence.
- **Cursor context usage:** Cursor ACP `session/update` `usage_update` events
  are projected to `thread.token-usage.updated` by
  `apps/server/src/provider/acp/AcpRuntimeModel.ts` and
  `apps/server/src/provider/Layers/CursorAdapter.ts`, enabling the existing
  context-window counter when Cursor emits that optional update.
- **Machine/provider invariant:** `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
  and `apps/web/src/routes/_chat.draft.$draftId.tsx` redirect stale routes
  outside the selected machine before mounting `ChatView`. The send/model
  selection handlers, `useHandleNewThread`, and `useAddProjectFromPath` also
  reject cross-machine targets and cross-environment draft reuse. Preserve
  these checks when rebasing route or composer changes; a provider instance id
  is only meaningful within the environment that owns the active thread.
- **Runtime ownership example:** when the UI is connected to both MacM1 and
  MacM4, selecting MacM4 makes new threads dispatch to MacM4 and use MacM4's
  provider accounts; selecting MacM1 does the same for MacM1. A thread already
  running on MacM4 remains bound to MacM4 when the picker switches to MacM1
  (and vice versa); switching only changes the visible machine-scoped UI and
  never retargets a running thread. Identically named instances such as
  `claude` or `codex` on the two machines are still distinct environment-owned
  providers.
- **Cursor account quota:** `apps/server/src/provider/Layers/CursorUsageApi.ts`
  provides a best-effort current billing-period usage snapshot for Cursor and
  `CursorAdapter.ts` refreshes it after session start and turn completion. It
  reads the machine-local Cursor credential (environment override, macOS
  Keychain, or CLI auth file), normalizes model/API/on-demand spend windows,
  and emits the existing `account.rate-limits.updated` event. The snapshot is
  therefore still isolated by `environmentId + providerInstanceId` in the web
  client. The API used here is Cursor's undocumented dashboard RPC because
  Cursor CLI/ACP does not expose a supported individual-account quota API;
  failures return no snapshot and must remain non-fatal. Revisit the endpoint,
  credential paths, and response schema if Cursor changes them.
- **Merge hotspots:** if upstream changes provider runtime events, ACP session
  updates, Cursor usage fetching, rate-limit activity selection, the persisted
  quota store, route guards, or composer dispatch, retain the composite
  environment/provider key, the Cursor `usage_update` mapping, the
  machine-local credential boundary, and the selected-machine invariant.

## 2026-07-30 upstream merge (project file picker, thread content search, docs split) — migration notes

Merged `upstream/main` through `323dc321a` (103 commits). Notable integrations:

- **Migration renumbering held.** Upstream added `035_ProjectionThreadTitleRegeneration`,
  colliding with the fork's frozen 33–35. Per the standing rule, **upstream's**
  migration was renumbered to the fork's next free id `038` (file + `.test.ts` +
  registry entry + the test's `toMigrationInclusive` bounds 37/38). Fork ids
  33–35 remain frozen; upstream's settled/snoozed stay at 36/37.
- **`RPC_REQUIRED_SCOPE` moved out of `ws.ts`.** Upstream extracted the scope map
  into `apps/server/src/auth/RpcAuthorization.ts` as the `RPC_REQUIRED_SCOPES`
  object (+ `requiredScopeForRpcMethod`). The fork's copy in `ws.ts` was dropped,
  and the fork-only WS method **`serverRefreshProviderRateLimits`** (quota meter)
  was ported into the new object. `RpcAuthorization.test.ts` asserts the key set
  equals `WsRpcGroup.requests.keys()`, so any future fork-added WS method **must**
  be registered there or the suite fails. (The fork's stale `replayEvents` entry
  was dropped — that method no longer exists in contracts.)
- **Snapshot projection is now composed in one place.** Upstream added
  `projectThreadDetailSnapshot` (`ActivityPayloadProjection.ts`) and called it at
  both snapshot sites, where the fork called its mobile-only
  `projectThreadSnapshotForClient` (`ClientProjection.ts`). Rather than nest them
  at each call site, **`projectThreadSnapshotForClient` now delegates to
  `projectThreadDetailSnapshot` internally** and is the single entry point used by
  `ws.ts` and `orchestration/http.ts`. Consequence: it no longer returns the input
  by reference for desktop clients, so `ClientProjection.test.ts` asserts
  `toStrictEqual` rather than `toBe`. Keep the composition — splitting it again is
  how the mobile filter gets dropped.
- **Bounded replay: fork still diverges on thread detail.** Upstream re-asserted
  `readEvents(afterSequence, Number.MAX_SAFE_INTEGER)` in the thread-detail
  catch-up. The fork's bounded `readEvents(afterSequence)` was kept, while
  adopting upstream's `projectActivityEvent(event)` mapping in that stream.
- **`effect` patch had to be re-derived.** The fork adds a hunk to the effect
  patch that strips the eager `fast-check` import from `Schema` (`toArbitrary`
  throws instead) — this is the fix for the **installed-mac-app launch crash**
  (commit `5a2ae9f79`). Upstream bumped effect `beta.78 → beta.102` and rewrote
  its patch; git concatenated the fork hunk onto upstream's file, producing a
  patch that failed to apply. Resolution: reset to upstream's patch, then re-derive
  the fork hunk with `pnpm patch effect@<version>` / `pnpm patch-commit` (the edit
  dir already has upstream's hunks applied, so the commit yields a superset).
  **Expect to repeat this on every effect bump.** Verify afterwards that
  `patches/effect@<version>.patch` touches `dist/Schema.js`, `dist/Schema.d.ts`,
  and `src/Schema.ts` in addition to upstream's `McpServer`/`RpcClient` hunks.
- **`WorkspaceSearchIndex` lazy native load kept.** Upstream widened the
  `@ff-labs/fff-node` import to a value import of `FileFinder` plus many types and
  added a `variant` parameter to `createFinder`. The fork's **lazy
  `await import("@ff-labs/fff-node")`** (so a native-module load failure surfaces
  as `WorkspaceSearchIndexCreateFailed` instead of killing the server at import
  time) was kept, with every upstream name converted to a **type-only** import;
  upstream's `variant` param was adopted. The fork's `enableFsRootScanning: false`
  / `enableHomeDirScanning: false` scoping survives. `vi.spyOn(FileFinder, ...)`
  still works through the dynamic import (same module namespace object), but stub
  finders now need `waitForIndexReady`.
- **`asarUnpack`: upstream converged past the fork.** Upstream restructured
  `createBuildConfig` so mac/linux get **no** `asarUnpack` at all (smart unpack
  handles native libs) and only Windows uses `WINDOWS_ASAR_UNPACK`. That is a
  stronger form of the fork's macOS-EMFILE guard, so the fork's
  `DESKTOP_ASAR_UNPACK`-based branch and its now-wrong duplicate test
  ("unpacks the full node_modules tree only for the Windows WSL backend") were
  dropped; the rationale comment was folded into upstream's test. Only the
  `artifactName` (`A2-Code-…`) and `appId` stay fork-specific. The `ulimit -n`
  lines in the workflows remain as a defensive net.
- **Add-project hook seam held again.** Upstream's only change to the palette's
  inline add-project body was a new "environment not connected"
  (`canCreateProjectInEnvironment`) guard; it was ported **into**
  `useAddProjectFromPath.ts` and the palette keeps its thin close-on-success
  wrapper. The palette's now-unused `primaryServerProvidersAtom` /
  `resolveDefaultProviderModelSelection` imports were removed again.
- **Composer attachments: upstream reverted to images-only again** (third time).
  Upstream restructured `addComposerImages` into a validate-and-reserve loop
  (`acceptedFiles`) followed by a compression phase, and re-added
  _"Please attach image files only."_. Resolution: keep upstream's two-phase
  structure; the validation loop now only size-rejects **non**-images (oversized
  images are downscaled by upstream's `compressImageToByteLimit` rather than
  refused, so `IMAGE_SIZE_LIMIT_LABEL` was deleted as unused), and the build phase
  branches to a `type: "file"` attachment before compression. `onComposerPaste`
  forwards **all** files again. Also re-added the `previewUrl` guard upstream
  omitted in the new `clearComposerPromptAndImages` — file attachments have none.
- **`buildLoadingThreadFromShell` needs the fork's detail-only fields.** Upstream's
  new loading-thread helper spreads a `ThreadShell` into a `Thread`; shells
  intentionally omit `queuedPrompts`, so the helper supplies `queuedPrompts: []`.
  Expect the same for any future fork thread-detail field.
- **Sidebar/composer structural churn re-absorbed.** Upstream moved the sidebar
  search group into a `fixedHeader` prop on `SidebarContent` (the fork's
  drop-zone `className` + `dropZoneProps` were re-applied to the same element),
  extracted `useEnvironmentStageLabel` into `SidebarStageBackdrop` (which now
  contains the fork's `APP_STAGE_LABEL` fallback verbatim, so the fork's local
  `useSidebarStageLabel` was deleted as duplication) and renamed `T3Wordmark`
  (kept as the fork's `AppWordmark` + `APP_MONOGRAM`/`APP_NAME_SUFFIX`).
- **`ChatView` thread var renamed.** Upstream introduced
  `activeServerThread = serverThread ?? loadingServerThread`; the fork's queued-
  prompt merge and server-error dismissal logic were rebased onto that name.
- **Independent convergence:** upstream landed the fork's own live-viewport-width
  sidebar fix (`f3507cdf1`) as `subscribeToViewportWidth`/`readViewportWidth`, and
  its own `exitObserved`/`stopRequested` + `wasReady` work in
  `DesktopBackendManager` (the fork's `onStartupFailed` hook sits on top). Both
  were resolved to upstream's naming.
- **`TraitsPicker` label logic taken from upstream.** Upstream extracted
  `buildTraitsTriggerDisplay` (unit-tested, fast-mode now shows an icon and only
  falls back to a "Normal" label when there'd be none). The fork's cosmetic
  `"Normal"` → `"Standard"` rename was dropped rather than diverge from the tested
  helper; re-apply in `buildTraitsTriggerDisplay` if the wording still matters.
- **Docs split.** Upstream deleted `docs/operations/ci.md` in favour of
  `docs/internals/ci.md`. The deletion was accepted and **`docs/internals/ci.md`
  was rewritten to describe the fork's build-only CI** (no test/typecheck gating,
  unsigned artifacts, the `build_payload` job). `docs/project/todo.md` was deleted
  upstream but kept — it is fork-local planning.
- **Test fixtures needed the other side's fields again**, as always:
  `queuedPrompts: []` in `decider.titleRegeneration.test.ts` (upstream-added), and
  `searchThreads` on the `ProjectionSnapshotQuery` stub in
  `serverRuntimeStartup.test.ts` (fork-added test).
- **Lint ratchet.** `t3code(no-manual-effect-runtime-in-tests)` keeps a per-file
  baseline in `oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts`
  (71 for `ProviderCommandReactor.test.ts`). Merging fork + upstream tests pushed
  it over; the fork's `thread_ref` test was converted from `Effect.runPromise` to
  upstream's `harness.runEffect` (which the rule does not count) rather than
  raising the baseline. Prefer `harness.runEffect` in new fork tests there.
- Fork package versions stay on the `0.0.25-amit` marker (upstream is at `0.0.31`).
  These are placeholders that `scripts/update-release-package-versions.ts`
  overwrites at release time.
- `apps/marketing/src/lib/site.ts` is upstream-new and hardcoded the upstream
  repo; `GITHUB_REPOSITORY_URL` was repointed at `amitbet/a2code`. The fork's
  pages use their own hardcoded links, so the unused `GITHUB_REPOSITORY_URL` /
  `MARKETING_STATS` imports were dropped from `Layout.astro` / `index.astro`.

## 2026-07-24 upstream merge (sidebar v2 settled/snoozed, glass UI refresh, Auto runtime mode) — migration notes

Merged `upstream/main` through `41a430a88`. Notable integrations:

- **Migration numbering is now permanently offset from upstream.** Upstream
  added its own migrations `33_ProjectionThreadsSettled` and
  `34_ProjectionThreadsSnoozed`, colliding with the fork's 33–35. Because the
  Migrator tracks the latest applied id, renumbering the _fork's_ migrations
  would have silently skipped upstream's on existing fork DBs (already at 35).
  So the **upstream** migrations were renumbered to `36`/`37` instead. Rule
  going forward: fork ids 33–35 are frozen; every new upstream migration id
  ≥ 33 must be renumbered to the fork's next free id when merging. All four
  colliding migrations are idempotent (`PRAGMA table_info` guards), so a
  renumber is safe to re-run.
- **Bounded replay: upstream partially converged.** The shell subscription in
  `ws.ts` was adopted wholesale from upstream — it now computes the replay gap
  against `orchestrationEngine.latestSequence` and falls back to a fresh
  snapshot when the gap exceeds `SHELL_RESUME_MAX_GAP`, which addresses the
  same stale-cursor OOM the fork's bounded replay guarded against. The
  **thread-detail** path still diverges: upstream reads
  `readEvents(afterSequence, Number.MAX_SAFE_INTEGER)`; the fork keeps the
  store's default bounded `readEvents(afterSequence)`. Upstream's new
  `requestCompletionMarker` ("synchronized" marker) plumbing was adopted in
  both paths.
- **Settled/snoozed thread lifecycle (sidebar v2).** Upstream threads now carry
  `settledOverride`/`settledAt` (required, decoding-defaulted) and
  `snoozedUntil`/`snoozedAt` (optional) through contracts, projector, pipeline,
  snapshot query, persistence, and client reducers — everywhere the fork adds
  `pinnedAt`/`forkedFromId`/`queuedPrompts`, so those files will keep
  conflicting. All were resolved additively (fork fields + upstream fields).
- **SidebarChrome extraction.** Upstream moved the sidebar header/footer/brand
  out of `Sidebar.tsx` into `apps/web/src/components/sidebar/SidebarChrome.tsx`
  with a hardcoded T3 wordmark. The fork's branding was re-applied _inside the
  new module_: `AppWordmark` (`APP_MONOGRAM`) + `APP_NAME_SUFFIX` + the
  `Version {APP_VERSION}` tooltip, keeping upstream's stage-backdrop styling.
  `Sidebar.tsx` no longer imports `../branding`.
- **Add-project hook kept; upstream logic ported in.** Upstream's
  `CommandPalette.tsx` inline add-project body gained provider-aware
  `defaultModelSelection` (`resolveDefaultProviderModelSelection` over the
  target environment's providers, falling back to primary providers) instead of
  hardcoded codex. That change was ported into
  `apps/web/src/hooks/useAddProjectFromPath.ts`; the palette keeps the thin
  close-on-success wrapper.
- **Composer glass shell.** Upstream rewrapped the composer in
  `chat-composer-glass-shell`/`chat-composer-glass-host` divs inside
  `ChatView.tsx`. The fork queue panel was re-injected inside the new
  `attachDraftHeroComposerAnchorRef` div, immediately above `<ChatComposer>`.
  The collapsed primary action keeps the fork's queue behavior (**Queue
  message**, enabled while running) plus upstream's new
  `noProviderAvailable`/`environmentUnavailable` guards.
- **Claude SDK telemetry: fork no-ops superseded.** Upstream now handles all
  SDK stream subtypes (`task_updated` no-op with its own comment, `api_retry`
  as a session heartbeat, `session_state_changed` state mapping, priority-gated
  `notification`, plus consumed UX-internal subtypes). The fork's silent no-op
  cases and its narrower `task_updated` regression test were dropped in favor
  of upstream's handling and its comprehensive subtype test. The old "Claude
  SDK telemetry handling" seam below is obsolete except for future additions.
- **Desktop state dir structure.** Adopted upstream's `configuredBaseDir`
  handling (explicit `--home-dir`/`T3CODE_HOME` puts even dev state under
  `userdata`), keeping the fork's `.a2code` base dir and `a2code`/`A2 Code`
  user-data dir names. Upstream tests asserting `.t3` paths and `T3 Code`
  display names were re-pointed at the fork values
  (`DesktopEnvironment.test.ts`, `branding.test.ts`).
- **Updater stays payload-only.** Upstream added a Windows silent-install
  confirm dialog in `SidebarUpdatePill.tsx` and a platform-aware warning in
  `getDesktopUpdateInstallConfirmationMessage`. The message function adopted
  upstream's shape (A2 Code branding); the pill keeps the fork's single-click
  no-confirmation apply. `DesktopUpdates.test.ts` remains the fork's
  payload-facade version (upstream's electron-updater test rewrite was
  discarded); its settings stub gained upstream's new `setMainWindowBounds`
  member.
- **Upstream test fixtures needed fork fields** (`queuedPrompts: []`,
  `forkedFromId`/`pinnedAt` columns) in `decider.settled.test.ts`,
  `decider.snoozed.test.ts`, `ProjectionRepositories.test.ts`; fork fixtures
  needed upstream fields (`settledOverride`/`settledAt`, engine
  `latestSequence`) in `ClientProjection.test.ts` and
  `serverRuntimeStartup.test.ts`. Expect the same dance next merge.
- **AGENTS.md policy conflict.** Upstream rewrote Task Completion Requirements
  around CI-gated verification and `test-t3-app`/`test-t3-mobile` skills. The
  fork keeps its own policy (local `vp check` + `vp run typecheck` + tests)
  because the fork CI is build-only and does not gate.

## 2026-07-19 upstream merge (draft hero, attachment hardening, mobile refresh) — migration notes

Merged `upstream/main` through `1735e27d9`. The fork-specific seams below were
re-audited, with these notable integrations:

- **Draft hero + queued prompts.** Upstream's centered draft-hero composer and
  branch-toolbar layout were retained. The fork queue panel now renders inside
  the new composer anchor, immediately above `ChatComposer`; running turns still
  enable the collapsed primary action and label it **Queue message**. Project
  selection remains required for new draft sends.
- **Attachment normalization hardening.** Upstream's stack-safe base64 data-URL
  parser was combined with the fork's arbitrary-file extension allowlist and
  file byte limits. Client timestamp canonicalization now applies before both
  `thread.turn.start` and fork-added `thread.prompt.queue` attachment
  normalization.
- **Thread subscription replay.** Upstream's pre-attached buffered live stream
  was adopted, while the fork's bounded `readEvents(afterSequence)` replay was
  preserved. Do not restore the upstream `Number.MAX_SAFE_INTEGER` replay limit;
  that reintroduces the stale-cursor backend OOM risk.
- **Payload-only updater vs release notes.** Upstream added required
  `DesktopUpdateState.releaseNotes` and nightly changelog UI. The fork still
  keeps the electron installer/updater and update state machine deleted;
  `payloadUpdateStateToDesktopUpdateState` returns an empty `releaseNotes` list
  because the payload manifest does not currently carry changelog metadata.
- **Branding and workflows.** Kept the fork's A2 Code production/web icons and
  marketing identity while adopting upstream's legal pages, Grok marketing,
  responsive layout, and nightly/dev asset pipeline. `.github/workflows` remains
  byte-identical to the pre-merge fork tip and contains only `ci.yml` and
  `release.yml`.

## 2026-06-20 upstream merge (client architecture rewrite) — migration notes

The `upstream/main` merge on 2026-06-20 (up to `97e5cd3bf`) brought two sweeping
refactors that moved several fork features onto new plumbing. Re-read this before
the next merge; the per-feature sections below were updated to match.

- **`apps/web/src/store.ts` was deleted** (upstream PR #2978 "Rewrite client
  connection architecture"). Client state now lives in an atom architecture
  under `packages/client-runtime/src/state/` and `apps/web/src/state/`. Fork
  logic that lived in `store.ts` was re-homed:
  - Quota-meter selector `selectLatestRateLimitActivitiesForInstance` →
    `apps/web/src/state/rateLimits.ts` as the `useLatestRateLimitActivitiesForInstance`
    atom hook (iterates `environmentThreadShells.threadRefsAtom`, filters by
    `shell.modelSelection.instanceId`, reads `environmentThreadDetails.activitiesAtom`).
    `useAccountRateLimitSnapshot.ts` now consumes this hook instead of the zustand
    selector. The old `store.test.ts` rate-limit unit test was dropped with
    `store.ts`; coverage now relies on the meter's other tests — consider porting
    a selector test against the new atom if it regresses.
  - File-attachment message mapping (`mapMessage`) is no longer needed: the new
    reducer carries contract attachments (image/file) through unchanged, and
    `ChatView.tsx` attaches image `previewUrl`s from `serverAttachmentUrlById`.
- **Effect services now use namespace node imports** (PR #3238 + the
  `t3code(namespace-node-imports)` oxlint rule). All fork server files were
  converted: `import * as NodeFS/NodePath/NodeOS/NodeUtil/NodeChildProcess/NodeFSP`.
  Touched fork files: `attachmentStore.ts`, `attachmentContent.ts`, `imageMime.ts`,
  `provider/Layers/ClaudeUsageApi.ts`, plus the fork test blocks in
  `attachmentStore.test.ts`, `ProviderCommandReactor.test.ts`, `ClaudeAdapter.test.ts`.
  When adding fork code, use namespace node imports and access service tags as
  `ServerConfig.ServerConfig` (not `yield* ServerConfig`).
- **Browser-mode tests (`*.browser.tsx`) were removed** (only `*.test.{ts,tsx}`
  run now). The in-chat-find browser test (`MessagesTimeline.browser.tsx`) was
  dropped; the feature itself survives in `MessagesTimeline.tsx`.

## 2026-07-13 upstream merge (Android mobile support) — migration notes

- Upstream extracted the `expo-widgets` configuration in
  `apps/mobile/app.config.ts` into `widgetsPlugin` and conditionally disables it
  for personal-team iOS builds. Keep that structure, including the new Android
  config plugins, but preserve the fork's `android: null` on the
  `AgentActivity` widget. The widget is iOS-only; without the opt-out,
  `expo-widgets` emits Android string resources under `res/xml/` while the
  generated manifest references them as normal string resources, causing AAPT
  resource-link failures.
- `apps/web/src/components/chat/ThreadErrorBanner.tsx` adopted upstream's
  content-width cap. Keep `AlertDescription` as a direct child of `Alert` (with
  the tooltip nested inside it), because the alert component assigns layout
  slots by direct child component name.

## Fork features

### Desktop/backend reliability safeguards

- Adds operational hardening found while debugging a local installed-app crash
  on 2026-07-09. These changes are fork-specific until/unless upstream grows
  equivalent replay/session safeguards.
- **Bounded WebSocket event catch-up — RETIRED as a fork divergence (2026-08-06).**
  Shell/thread subscriptions previously used
  `readEvents(afterSequence, Number.MAX_SAFE_INTEGER)`, so a stale client cursor
  could force the backend to decode the entire global `orchestration_events`
  table before filtering, driving the desktop backend into Node heap OOM.
  Upstream now bounds **both** paths itself (gap vs `latestSequence`, fresh
  snapshot past `SHELL_RESUME_MAX_GAP` / `THREAD_RESUME_MAX_GAP`), so `ws.ts` is
  upstream's again. Just never let `Number.MAX_SAFE_INTEGER` back in.
- **Stop-button stale projection cleanup.** If a turn start is requested but no
  provider turn id is ever materialized, interrupt/stop events now delete the
  pending-start placeholder so the UI does not stay stuck on "working" with
  nothing real to stop. Session updates to `stopped` / `interrupted` / `error`
  also clear pending placeholders.
- **Stopped-runtime/session projection reconciliation.** On backend startup,
  stopped provider runtime bindings are compared against projected thread
  sessions. If `provider_session_runtime` says a binding is stopped but
  `projection_thread_sessions` still says the thread is running, startup
  dispatches a normal `thread.session.set` to `stopped`. The existing projection
  path then settles any concrete running turn.
- Files:
  - `apps/server/src/ws.ts` — **modified**: shell and thread detail subscription
    catch-up replays use bounded `readEvents(afterSequence)` instead of
    `Number.MAX_SAFE_INTEGER`.
  - `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — **modified**:
    clears pending turn-start placeholders on no-turn interrupt, session stop
    request, and terminal session statuses.
  - `apps/server/src/serverRuntimeStartup.ts` — **modified**: startup
    reconciliation from stopped provider runtime bindings to stopped projected
    thread sessions.
  - Tests: `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts`
    and `apps/server/src/serverRuntimeStartup.test.ts` cover the stale
    pending-start and stopped-runtime reconciliation paths.

### Queued prompt steering

- Adds Codex-like running-turn prompt handling: sending while a thread is
  running queues the prompt instead of immediately steering; each queued prompt
  can be removed or promoted with **Steer**, which sends it to the active agent
  mid-flight. When the session becomes ready/idle, queued prompts drain FIFO as
  normal next turns.
- Provider behavior remains routed through the existing provider turn-start
  path. For running sessions, adapters that already treat a second send as a
  steer continue to do so; for idle/ready sessions the same command starts the
  next turn. This keeps the feature provider-neutral across Codex, Claude,
  Cursor, Grok, and OpenCode.
- Merge note: migration `034_ProjectionQueuedPrompts` is fork-added. Fork ids
  33-35 are frozen (see the 2026-07-24 merge notes): renumber **upstream's**
  colliding migrations to the fork's next free id, never the fork's.
- Files:
  - `packages/contracts/src/orchestration.ts` — **modified**: queued prompt
    schema on `OrchestrationThread`, prompt queue/remove/steer commands, and
    prompt queued/removed/steer-requested events.
  - `packages/client-runtime/src/operations/commands.ts` and
    `packages/client-runtime/src/state/threadCommands.ts` — **modified**:
    client command helpers/atoms for queue, remove, and steer.
  - `apps/server/src/orchestration/{decider,projector,Schemas,Normalizer}.ts`
    — **modified**: validate/project queued prompts and normalize queued
    attachments.
  - `apps/server/src/orchestration/Layers/{ProjectionPipeline,ProjectionSnapshotQuery,ProviderCommandReactor}.ts`
    — **modified**: persist/read queued prompts, drain FIFO after ready/idle
    session updates, and promote queued prompts into provider turn-start work.
  - `apps/server/src/persistence/Migrations/034_ProjectionQueuedPrompts.ts` —
    **fork-added**: `projection_queued_prompts` table.
  - `apps/web/src/components/ChatView.tsx` and
    `apps/web/src/components/chat/{ChatComposer,ComposerPrimaryActions}.tsx` —
    **modified**: running composer queues by default and renders queue controls
    with explicit **Steer** promotion.

### In-chat find (Cmd/Ctrl+F)

- Adds a browser-style find toolbar to the chat timeline. Because the timeline
  is rendered through a virtualized list (`@legendapp/list`), the browser's
  native find-in-page only sees the handful of mounted rows — this feature
  searches the underlying row data instead, scrolls each match into view, and
  paints highlights over the rendered DOM.
- Files (all fork-added unless noted):
  - `apps/web/src/components/chat/chatSearch.ts` — pure search logic
    (occurrence extraction over `MessagesTimelineRow` data) + unit tests in
    `chatSearch.test.ts`.
  - `apps/web/src/components/chat/ChatSearchBar.tsx` — the floating find
    toolbar (query input, match counter, prev/next, close).
  - `apps/web/src/components/chat/useChatSearchHighlight.ts` — paints matches
    via the CSS Custom Highlight API (no DOM mutation); re-runs on scroll /
    resize / DOM mutation since only rendered rows can be highlighted.
  - `apps/web/src/components/chat/MessagesTimeline.tsx` — **modified**: owns the
    search state (open/query/active match), the `Cmd/Ctrl+F` capture-phase
    keydown listener, and `scrollToIndex` navigation. Search resets per thread
    because the component is keyed on the active thread id.
  - `apps/web/src/index.css` — `::highlight(chat-search)` and
    `::highlight(chat-search-active)` styles.
- Behavior: `Cmd/Ctrl+F` opens/refocuses the bar; `Enter` / `Shift+Enter` step
  through matches (wrapping); `Escape` closes. Matching is case-insensitive over
  the raw row text (message bodies, proposed-plan markdown, work-log
  labels/commands/details, fold labels).

### Answered user-input exchanges (questions + answers in the timeline)

- Renders resolved `AskUserQuestion` interactions as their own timeline
  messages: once the user answers a user-input request, the questions are paired
  with the submitted answers and shown as a distinct "Answered" row (question
  header + full text + selected option(s) / free-text value), separate from the
  agent work log. Landed in commit `f3ef1bec8`.
- Files (all fork-added surface unless noted):
  - `apps/web/src/session-logic.ts` — **modified**: `deriveUserInputExchanges(
activities)` pairs `user-input.requested` questions with the matching
    `user-input.resolved` answers by `requestId` (ordered via
    `compareActivitiesByOrder`), plus `buildUserInputExchangeAnswers` and the
    `UserInputExchange` / `UserInputExchangeAnswer` types and the `kind:
"user-input"` timeline-row variant. Exchanges with zero answers (e.g.
    aborted requests) are dropped.
  - `apps/web/src/session-logic.test.ts` — **modified**: covers the pairing
    logic (header/values normalization, custom free-text, unanswered requests).
  - `apps/web/src/components/chat/MessagesTimeline.logic.ts` — **modified**:
    classifies `user-input` rows and **excludes them from the work log** so an
    answered exchange reads as a conversation message, not a tool step.
  - `apps/web/src/components/chat/MessagesTimeline.tsx` — **modified**: renders
    the row via `UserInputAnswerTimelineRow` for `row.kind === "user-input"`.
  - `apps/web/src/components/chat/chatSearch.ts` — **modified**: includes
    user-input row text in the in-chat find index (see "In-chat find" above).
  - `apps/web/src/components/ChatView.tsx` — **modified**: wires it in via
    `useMemo(() => deriveUserInputExchanges(threadActivities), …)` and feeds the
    exchanges into the timeline rows.
- **Merge seam:** `MessagesTimeline.tsx`, `MessagesTimeline.logic.ts`, and
  `ChatView.tsx` are all files upstream rewrites (they conflicted in the
  2026-07-24 merge). Survived that merge intact, but re-apply the row
  classification, the `UserInputAnswerTimelineRow` render branch, the search
  indexing, and the `deriveUserInputExchanges` wiring if a future merge clobbers
  any of them. `session-logic.test.ts` is the behavioral guard.

### Thread forking (`/fork` + context menu)

- Creates a new thread that inherits the source thread's provider conversation
  context, staying in the **same git environment** (same project, model, runtime
  mode, branch, worktree — no new worktree, no subthread runtime model).
- Entry points (both fork-added):
  - sidebar thread context-menu action: **`Fork thread`**
  - composer slash command: **`/fork`** (only offered on a started server
    thread, not on a draft — a draft has no context to fork)
- **Implementation approach — an implicit thread reference.** On the fork's
  **first user turn**, `ProviderCommandReactor.buildSendTurnRequestForThread`
  prepends `forkedFromId` to the same bounded, de-duplicated reference list used
  by explicit `@thread_ref:<id>` tokens. The shared loop resolves the source,
  serializes its settled history with `buildThreadTranscript`, persists it as
  `referenced-thread-<id>.md` through `createThreadContextArtifact`, and appends
  the same mandatory path-reading instruction to the provider prompt. This is
  provider-neutral: same-provider, cross-provider, regular, `/fork`, and queued
  prompt forks all use this one path.
- Transcript contents are intentionally not inlined, so the agent must inspect
  the complete file with its read/search tools and the prompt does not spend
  context on a large preview. The persisted transcript is not subject to the
  regular 10 MiB provider-attachment limit, and its tool results do not use the
  serializer's normal per-result preview limit. A failure to build the artifact
  skips that reference and is logged.
- **Replay transcript serializes completed work, not just text.**
  `buildThreadTranscript` interleaves messages with **completed tool steps**
  (`item.completed` activities — the call via `deriveToolActivityPresentation`
  plus its result via `deriveToolActivityResult`, read from the untruncated
  `payload.data`) and errors, in chronological order. It deliberately omits:
  proposed plans (intent / in-flight, not completed work), the **currently
  running turn** (excluded by `latestTurn.state === "running"` + matching
  `turnId`, so an in-flight prompt and its partial work never leak in), and
  `tool.started`/`tool.updated` lifecycle noise. The only thing it cannot
  recover is what isn't persisted at all — the model's raw hidden reasoning and
  the exact backend context window — which remain native-fork-only.
- **`buildThreadTranscript` is a shared primitive, not fork-specific.** It is
  intended to also back: referencing one thread from another, "copy thread ref"
  (`thread_ref:<id>`) tokens, exporting a conversation (e.g. "export thread as
  zip": transcript `.md` + attachments subdir), and handoff to external agents.
  Keep it pure / I/O-free so those consumers stay trivial.
- The source transcript is context for the provider, not copied projection
  history: prior messages do not render as ordinary rows in the fork. Making the
  implicit source reference a first-class visible chip on the fork's first
  message is a deferred enhancement.
- Files:
  - `packages/contracts/src/orchestration.ts` — **modified**: `ThreadForkCommand`
    (`thread.fork`: `threadId`, `sourceThreadId`, `title`, and the optional
    **`modelSelection`** target used to switch providers on fork), added to both
    command unions; `forkedFromId` added to `OrchestrationThread` (optional) and
    `ThreadCreatedPayload` (optional). Also defines `thread.prompt.fork`, which
    atomically creates a fork, removes the selected queued prompt from the
    source, and starts it on the new thread.
  - `packages/contracts/src/provider.ts` — **modified**: `forkFromThreadId` on
    `ProviderSessionStartInput`. This lower-level native-fork primitive remains
    available but is no longer selected by the user-facing fork workflow.
  - `apps/server/src/provider/Services/ProviderAdapter.ts` — **modified**:
    `ProviderAdapterCapabilities.nativeFork: boolean` (retained as a provider
    capability, but not used by the user-facing fork workflow).
  - `apps/server/src/provider/Layers/{CodexAdapter,ClaudeAdapter,CursorAdapter,GrokAdapter,OpenCodeAdapter}.ts`
    — **modified**: each declares `nativeFork` (Codex `true`, rest `false`).
  - `packages/shared/src/threadTranscript.ts` + `package.json`
    (`./threadTranscript` export) — **fork-added**: pure `buildThreadTranscript`
    serializer (no I/O), shared between server and web.
  - `apps/server/src/threadContextArtifact.ts` — **fork-added**:
    `createThreadContextArtifact` writes a transcript into the attachment store
    without the provider attachment-size clamp and returns its absolute path
    metadata.
  - `apps/server/src/orchestration/decider.ts` — **modified**: `thread.fork`
    case validates source exists / new absent, copies source metadata
    (`modelSelection` now `command.modelSelection ?? source.modelSelection`), and
    emits a `thread.created` event tagged with `forkedFromId` (no new event
    type — reuses `thread.created`). The `thread.prompt.fork` case composes
    `thread.fork`, source prompt removal, and target `thread.turn.start` into one
    projected command sequence.
  - `apps/server/src/orchestration/projector.ts` — **modified**: carries
    `forkedFromId` into the read model (only when set).
  - `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — **modified**:
    `thread.created` upsert writes `forkedFromId`.
  - `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` —
    **modified**: selects `forked_from_id` in the four full-row thread queries
    and surfaces it in the thread-detail builder (the shell builder does **not**
    carry it).
  - `apps/server/src/persistence/Services/ProjectionThreads.ts` +
    `Layers/ProjectionThreads.ts` — **modified**: `forkedFromId` field +
    `forked_from_id` column in INSERT / ON CONFLICT / SELECTs.
  - `apps/server/src/persistence/Migrations/033_ProjectionThreadsForkedFrom.ts` —
    fork-added migration (adds `forked_from_id` to `projection_threads`);
    registered in `apps/server/src/persistence/Migrations.ts` as id `33`.
  - `apps/server/src/provider/Layers/ProviderService.ts` — **modified**: on
    `startSession`, when the thread has no cursor yet and `forkFromThreadId` is
    set, resolves the source thread's persisted conversation id and builds the
    `{ threadId, fork: true }` cursor (`readResumeCursorThreadId` helper). This
    lower-level native path is retained but user-facing forks no longer request
    it.
  - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` —
    **modified**: on the fork's first user turn, treats `forkedFromId` as the
    first implicit thread reference and runs it through the exact explicit
    `@thread_ref` artifact loop. Acquires `ServerConfig`/`FileSystem`/`Path` for
    the artifact.
  - `apps/server/src/provider/Layers/CodexSessionRuntime.ts` — **modified**:
    `CodexResumeCursorSchema` gains optional `fork`; `openCodexThread` adds a
    `thread/fork` branch; `CodexThreadOpenMethod`/`CodexThreadOpenResponse`
    include `thread/fork`; `readForkCursorThreadId` helper. This remains a
    lower-level primitive and is not used by the user-facing fork workflow.
  - `packages/client-runtime/src/operations/commands.ts` — **fork-added (post-merge)**:
    `forkThread` command builder + `ForkThreadInput` (dispatches `thread.fork`),
    mirroring `createThread`. Wired as the `fork` atom command in
    `packages/client-runtime/src/state/threadCommands.ts`; `forkThreadPrompt` /
    `ForkThreadPromptInput` are wired as the `forkPrompt` atom command for queue
    forks. This replaces the old direct `api.orchestration.dispatchCommand`
    call after the atom-architecture rewrite.
  - `apps/web/src/hooks/useThreadActions.ts` — **modified**: `forkThread` action
    now dispatches via `useAtomCommand(threadEnvironment.fork)`, waits for the new
    thread to project (`waitForServerThread` polls `readThreadShell` rather than
    the deleted zustand store), then navigates. Accepts an optional
    `{ modelSelection }` to fork onto a different provider.
    NOTE: an explicit "fork to provider X" menu is **not yet wired**; the
    cross-provider path is reachable today by forking and then switching the
    provider in the composer model picker before sending the first message
    (the shared transcript reference works across providers).
    `forkQueuedPrompt` dispatches the atomic queue-fork command and navigates to
    the projected target thread.
  - `apps/web/src/components/threadActionMenu.logic.ts` — **modified**: `fork` id +
    `Fork thread` item in the shared `buildThreadActionMenuItems` list, so both the
    default sidebar and the chat header offer it (2026-08-14).
  - `apps/web/src/components/Sidebar.tsx` (default, v2-derived) and
    `apps/web/src/hooks/useThreadActionMenu.ts` (chat header) — **modified**: each
    handles `case "fork"` via `forkThread`.
  - `apps/web/src/components/LegacySidebar.tsx` (the old v1 sidebar) — **modified**:
    `Fork thread` menu item + threads `forkThread` through the sidebar prop chain.
  - `apps/web/src/components/ChatView.tsx` — **modified**: queued prompts expose
    a **Fork** action alongside Edit/Steer; it uses `forkQueuedPrompt`, so it
    receives the same implicit source reference as regular forks.
  - `apps/web/src/components/chat/ChatComposer.tsx` +
    `apps/web/src/composer-logic.ts` — **modified**: `/fork` slash command
    (`"fork"` added to `ComposerSlashCommand`) and its handler.

### Pinned project threads

- **Largely superseded by upstream as of the 2026-08-06 merge** — upstream
  shipped its own pinning on the same `pinned_at` column, with a `threadPinning`
  capability and `thread.pin`/`thread.unpin` commands. The mobile fork surface
  was dropped entirely; on web, only the v1 `Sidebar.tsx` still drives pinning
  through the fork's `setThreadPinned` (`thread.meta.update`). See that merge's
  notes above. The description below is retained for the fork-added migration
  `035_ProjectionThreadsPinnedAt`, which stays frozen.
- Adds a persisted per-thread `pinnedAt` metadata field. Pinned threads stay at
  the top of their project's thread list, ordered by most recent pin time before
  falling back to the existing sidebar thread sort. The sidebar renders a pin
  icon immediately to the left of pinned thread titles.
- Entry point: sidebar thread context menu, **Pin thread** / **Unpin thread**.
- Merge note: migration `035_ProjectionThreadsPinnedAt` is fork-added. Fork ids
  33-35 are frozen (see the 2026-07-24 merge notes): renumber **upstream's**
  colliding migrations to the fork's next free id, never the fork's.
- Files:
  - `packages/contracts/src/orchestration.ts` — **modified**: optional
    `pinnedAt` on thread detail/shell schemas and thread metadata update command
    / event payload.
  - `packages/client-runtime/src/state/threadSort.ts` — **modified**: pinned
    threads sort before unpinned threads.
  - `packages/client-runtime/src/state/threadReducer.ts` — **modified**:
    carries `pinnedAt` through thread metadata updates.
  - `apps/server/src/orchestration/{decider,projector}.ts` — **modified**:
    accepts pin/unpin metadata updates and projects them into the read model.
  - `apps/server/src/orchestration/Layers/{ProjectionPipeline,ProjectionSnapshotQuery}.ts`
    — **modified**: persists and reads `pinnedAt` for thread rows and snapshots.
  - `apps/server/src/persistence/Services/ProjectionThreads.ts` +
    `Layers/ProjectionThreads.ts` — **modified**: `pinnedAt` field +
    `pinned_at` column in INSERT / ON CONFLICT / SELECTs.
  - `apps/server/src/persistence/Migrations/035_ProjectionThreadsPinnedAt.ts` —
    **fork-added**: adds nullable `pinned_at` to `projection_threads`;
    registered in `apps/server/src/persistence/Migrations.ts` as id `35`.
  - `apps/web/src/hooks/useThreadActions.ts` — **modified**: `setThreadPinned`
    dispatches through `thread.meta.update`.
  - `apps/web/src/components/LegacySidebar.tsx` — **modified**: context-menu actions
    and pin icon beside thread titles. (Was `Sidebar.tsx` before the 2026-08-14
    sidebar rename; the default sidebar uses upstream's `pinThread`/`unpinThread`.)
- Mobile surface (`apps/mobile`, added 2026-07-25 — `pinnedAt` already flowed
  through the shared shell schemas, these changes only add UI + ordering):
  - `src/features/home/useThreadListActions.ts` — **modified**: `pin`/`unpin`
    actions through `threadEnvironment.updateMetadata`; exports
    `toggleThreadPinned`.
  - `src/features/threads/thread-list-items.tsx` (v1 rows) and
    `thread-list-v2-items.tsx` (v2 rows) — **modified**: Pin/Unpin in the
    long-press `ControlPillMenu`, `pin.fill` indicator on pinned rows,
    `onTogglePinThread` prop.
  - `src/features/threads/threadListV2.ts` — **modified**:
    `sortThreadsForListV2` floats a pinned block (latest pin first) above the
    static creation-order list (guarded by `threadListV2.test.ts`). The v1
    grouped Home list was already pin-aware via the shared `sortThreads`.
  - `src/features/home/{HomeScreen,HomeRouteScreen}.tsx`,
    `src/features/threads/ThreadNavigationSidebar.tsx` — **modified**: thread
    the callback into every row render site.
  - `src/components/AppSymbol.tsx` — **modified**: maps `pin`, `pin.fill`,
    `pin.slash` SF symbols to tabler icons for Android.
  - Caution (mobile typechecks with tsc, not tsgo): `apps/mobile`'s
    `typecheck` script deliberately runs official `tsc --noEmit`. Running
    `tsgo` directly on `apps/mobile` can report ~65 spurious
    `navigation.navigate` "parameter of type 'never'" errors — tsgo's
    react-navigation static-API inference (`RootNavigator extends
RootStackType` in `src/Stack.tsx`) is unstable near its complexity limit
    and flips with unrelated byte-level changes. Trust `vp run typecheck`
    (which uses the package script); do not switch mobile to tsgo.

### Thread references (`@thread_ref:<id>`)

- A second consumer of the thread-artifact primitive: an inline
  `@thread_ref:<id>` token in a message pulls the referenced thread's transcript
  in as context, reusing `createThreadContextArtifact`. The full transcript is
  stored on disk and only a mandatory read/search instruction plus its absolute
  path is sent to the provider; no transcript preview is inlined. Works across
  models/providers. **Copy thread ref** in the sidebar thread context menu copies
  the token.
- Files:
  - `packages/shared/src/threadReference.ts` (+ `./threadReference` export in
    `package.json`, + `threadReference.test.ts`) — **fork-added**: pure token
    format/parse (`formatThreadReference`, `parseThreadReferenceIds`).
  - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` —
    **modified**: `buildSendTurnRequestForThread` parses `@thread_ref` tokens
    from the message text, resolves each thread (skips self/unknown, caps at
    `MAX_THREAD_REFERENCES`), persists a complete transcript artifact per
    reference, and appends their path-only instructions to the provider prompt.
  - `apps/web/src/components/threadActionMenu.logic.ts` — **modified**:
    `copy-thread-ref` id + item — since 2026-08-26 a **child of upstream's `copy`
    submenu**; handled in `Sidebar.tsx` and `useThreadActionMenu.ts`, each with their own
    `copyThreadRefToClipboard`.
  - `apps/web/src/components/LegacySidebar.tsx` — **modified**: `Copy thread ref`
    context-menu item + `copyThreadRefToClipboard`.
  - `packages/shared/src/composerInlineTokens.ts` — **modified**:
    `collectMentionTokens` skips `@thread_ref:<id>`. The token shares the `@`
    trigger with file mentions, and any consumer that turns a mention into a
    chip (composer paste, draft/prompt rehydration via
    `splitPromptIntoComposerSegments`, the mobile composers) would re-serialize
    it as `[thread_ref:<id>](thread_ref%3A<id>)` — dropping the leading `@` so
    the server parser no longer recognizes it. Exclude it here, once, rather
    than per consumer.
- **Merge guard:** `ProviderCommandReactor.test.ts` has a regression test
  ("stores and path-references a thread transcript when a message contains
  thread_ref:<id>") alongside fork tests for the same-provider,
  cross-provider, and queued-prompt paths. All four assert the same
  `referenced-thread-<id>.md` artifact pipeline, and fail if an upstream merge
  drops or splits the reactor wiring. The pure serializer/token helpers also
  have unit tests in `packages/shared` (fork-added files, so merge-safe).
  `ComposerPromptEditor.test.ts` verifies that the clipboard-to-composer path
  keeps a thread reference literal so the server parser can still recognize it,
  and `composerInlineTokens.test.ts` / `composer-editor-mentions.test.ts` guard
  the tokenizer exclusion that makes every composer path behave that way.

### Agent-initiated thread history search (MCP `threads` toolkit)

- Where `@thread_ref` requires the user to name the thread up front, this lets
  the agent find prior threads itself: `thread_search` runs FTS5 keyword search
  over projected message text and returns title + highlighted snippet;
  `thread_read` materializes one transcript via the same
  `createThreadContextArtifact` primitive and returns its path only. Both are
  project-scoped.
- **Cross-project boundary:** off by default via
  `enableCrossProjectThreadSearch`. When disabled, the project predicate is part
  of the FTS query itself, so other projects' rows are never read, and the
  `otherProjectMatches` escalation hint is withheld (the count alone leaks that
  something elsewhere matched). When enabled, one scan orders in-project matches
  first, `scope: "project"` still returns only in-project threads plus the
  count, and `scope: "all"` returns everything labelled by project title.
  `thread_read` enforces the same boundary, so an agent cannot bypass search by
  passing a thread id it learned elsewhere.
- Files:
  - `apps/server/src/persistence/Migrations/043_ProjectionThreadMessagesFts.ts`
    (+ test) — **fork-added**: external-content FTS5 index over
    `projection_thread_messages` with triggers filtered to settled
    (`is_streaming = 0`) `user`/`assistant` rows, plus an explicit backfill
    (FTS5 `rebuild` would ignore those filters). FTS5 is compiled into both
    `bun:sqlite` and `node:sqlite`, so no loadable extension is involved.
  - `apps/server/src/persistence/Services/ProjectionThreadSearch.ts` and
    `apps/server/src/persistence/Layers/ProjectionThreadSearch.ts` (+ test) —
    **fork-added**: search repository. Note `bm25`/`snippet` are FTS5 auxiliary
    functions and cannot be nested in an aggregate, so ranking is per message
    and collapses per thread in `bestPerThread`.
  - `apps/server/src/mcp/toolkits/threads/{tools,handlers}.ts` — **fork-added**:
    the toolkit, mirroring `toolkits/preview/`.
  - `apps/server/src/mcp/McpHttpServer.ts` — **modified**: registers
    `ThreadsToolkitRegistrationLive` alongside the preview toolkits in `layer`.
  - `apps/server/src/mcp/McpInvocationContext.ts` — **modified**: `"threads"`
    added to `McpCapability`; `requireMcpCapability` narrowed to `"preview"`
    because its failure type is preview-specific.
  - `apps/server/src/mcp/McpSessionRegistry.ts` — **modified**: capability set
    is now `["preview", "threads"]`.
  - `apps/server/src/orchestration/runtimeLayer.ts` — **modified**:
    `ProjectionThreadSearchRepositoryLive` merged into
    `OrchestrationInfrastructureLayerLive` so it resolves `SqlClient` there.
    Providing it at the routes layer instead leaks `SqlClient` into
    `makeRoutesLayer`'s requirements and breaks `server.test.ts`.
  - `packages/contracts/src/settings.ts` — **modified**:
    `enableCrossProjectThreadSearch` (defaults false).
  - `apps/server/src/provider/CodexDeveloperInstructions.ts` — **modified**:
    `T3_CODE_THREAD_HISTORY_INSTRUCTIONS` appended after the browser block in
    both mode prompts. Codex-only, matching the existing browser instructions;
    other providers get the tool descriptions but no prompt scaffolding.
- **Merge guard:** the migration test asserts the streaming case (a message must
  not enter the index until `is_streaming` flips to 0) and delete/edit
  consistency; the repository test asserts the scope boundary in both
  directions. Both are fork-added files, so they are merge-safe.

### Thread export (zip)

- A third consumer of the thread-artifact primitive: download a thread as a zip
  containing `transcript.md` (the shared serializer) plus every attachment under
  `attachments/`. Sidebar context-menu action **Export thread (zip)**.
- Files:
  - `apps/server/src/threadExport.ts` (+ `threadExport.test.ts`) — **fork-added**:
    pure `buildThreadExportZip` (transcript + attachment bytes → zip via
    `fflate`). The builder is pure; the caller resolves attachment bytes.
  - `apps/server/src/http.ts` — **modified**: `threadExportRouteLayer`
    (`GET /api/thread-export/<id>`, read-scope auth, reads attachment bytes from
    the store, returns `application/zip` with `Content-Disposition`). Uses a
    dedicated top-level path (not under `/api/orchestration/v1`) to avoid
    colliding with the orchestration HttpApi.
  - `apps/server/src/server.ts` — **modified**: registers `threadExportRouteLayer`
    in `makeRoutesLayer`.
  - `apps/server/package.json` — **modified**: adds the `fflate` dependency.
  - `apps/web/src/components/threadActionMenu.logic.ts` — **modified**: `export-zip`
    id + item; handled in `Sidebar.tsx` and `useThreadActionMenu.ts` (both resolve the
    prepared connection and stream `fetchEnvironmentThreadExport` to a blob download).
  - `apps/web/src/components/LegacySidebar.tsx` — **modified**: `Export thread (zip)`
    context-menu item; builds the env-aware export URL from the prepared
    connection (`readPreparedConnection(environmentId)` → `environmentEndpointUrl(
httpBaseUrl, pathname)`; the pre-merge `resolveEnvironmentHttpUrl` helper was
    removed with the old environment catalog), fetches it with
    `credentials: "include"`, and downloads the blob.
- **Merge guard:** `threadExport.test.ts` asserts the zip contains
  `transcript.md` + `attachments/<name>` and skips attachments without bytes.

### Live provider quota meter (5h / weekly bars + Claude spend bar)

- Surfaces provider rate-limit / quota usage in the composer footer as a small
  meter with progress bars: Claude session (5h), weekly (incl. Opus/Sonnet
  splits), and a **spend bar** (`$used / $limit`, e.g. `$169.27 / $1,000.00`)
  for accounts with a monthly extra-usage limit. Codex (GPT) 5h/weekly windows
  flow through the same meter.
- This feature has already been silently dropped twice by upstream merges
  (most recently the 2026-06-17 `upstream/main` merge), because the wiring lives
  in files upstream rewrites. **When resolving conflicts, re-apply all of the
  pieces below — losing any one of them makes the bars disappear.**
- Files:
  - `apps/server/src/provider/Layers/ClaudeUsageApi.ts` — fork-added. Polls
    Claude's `/api/oauth/usage` endpoint and normalizes it into a
    `ProviderRateLimitSnapshot` (`five_hour`, `seven_day[_opus|_sonnet]`, and
    `spendWindow(extra_usage)` → the `kind: "spend"` window). Resolves the OAuth
    token like Claude Code (env → `.credentials.json` → macOS keychain).
  - `apps/server/src/provider/Layers/ClaudeAdapter.ts` — **modified**: imports
    `fetchClaudeUsageSnapshot`, defines `refreshClaudeUsage(context)` (fetches +
    emits an `account.rate-limits.updated` event), and calls it in two places:
    on **session start** (`runFork(refreshClaudeUsage(context))`) and **after
    each turn** (`yield* Effect.forkDetach(refreshClaudeUsage(context))` right
    after `completeTurn` in `handleResultMessage`). Without these call sites the
    snapshot is never emitted and no Claude bars show (Codex still would).
  - `packages/contracts/src/providerRuntime.ts` — **modified**: the
    `ProviderRateLimitWindowKind` literal union must include `"spend"`.
  - `apps/web/src/lib/rateLimits.ts` — **modified**: `WINDOW_KINDS` must include
    `"spend"`; `deriveLatestRateLimitSnapshot` merges windows across activities
    and is **order-independent** (it sorts rate-limit activities newest-first by
    `createdAt`, later input position winning ties) so it can accept activities
    merged across multiple threads; `shouldShowRateLimitMeter` gates visibility.
    Also adds `sanitizeRateLimitSnapshot` (validates a persisted snapshot) and
    `freshestRateLimitSnapshot` (picks the newer of two by `updatedAt`).
  - `apps/web/src/state/rateLimits.ts` — fork-added (this replaced the deleted
    `store.ts` selector in the 2026-06-20 atom rewrite; see those notes). The
    `useLatestRateLimitActivitiesForInstance` hook returns the latest
    `account.rate-limits.updated` activity for every thread bound to a provider
    instance, across all environments. This is the account/subscription-wide
    source for the meter — quota is an account property, not a per-conversation
    one.
  - `apps/web/src/rateLimitSnapshotStore.ts` — fork-added. A `persist`-backed
    (localStorage, key `t3code:rate-limit-snapshots:v1`) zustand store mapping
    `instanceId → RateLimitSnapshot`, recording only strictly-newer snapshots.
    This survives reloads and the per-thread detail subscription being evicted
    (the only channel that carries live rate-limit activities), so the meter
    keeps the freshest figures we've ever seen for a subscription.
  - `apps/web/src/lib/useAccountRateLimitSnapshot.ts` — fork-added. Hook that
    wraps the selector (`useShallow`), derives the merged live snapshot, mirrors
    the freshest into the persistent store, and returns
    `freshestRateLimitSnapshot(live, persisted)` — so an idle/evicted/reloaded
    conversation no longer drops to "no data" or pins a stale "updated 14h ago"
    while another conversation on the same subscription reports fresher usage.
  - `apps/web/src/components/chat/RateLimitMeter.tsx` — fork-added. Renders the
    bars + popover (including the spend `detail` dollar string).
  - `apps/web/src/components/chat/ChatComposer.tsx` — **modified**: imports
    `RateLimitMeter` + `shouldShowRateLimitMeter` (+ the `RateLimitSnapshot`
    type) and `useAccountRateLimitSnapshot`; derives `activeRateLimits =
useAccountRateLimitSnapshot(selectedInstanceId)` (NOT a per-thread
    `useMemo(deriveLatestRateLimitSnapshot(activeThreadActivities))` — that was
    the old per-conversation wiring), passes it into
    `ComposerFooterPrimaryActions`, and renders `<RateLimitMeter>`. This is the
    wiring upstream merges keep clobbering — re-apply it on top of any upstream
    composer-footer refactor.
- Note: the Claude spend window only renders if the usage endpoint returns a
  numeric `extra_usage.utilization` and `is_enabled !== false` (see
  `spendWindow()` in `ClaudeUsageApi.ts`).
- Data-availability note: live thread activities arrive over the per-thread
  **detail** subscription (evicted when idle), so the cross-thread merge only
  sees conversations loaded this session. The persistent snapshot store
  (`rateLimitSnapshotStore.ts`) bridges the gap — it remembers the freshest
  snapshot per subscription across reloads/evictions. The remaining limit:
  figures can only be as fresh as the last time _some_ conversation on that
  subscription streamed usage this client. A truly authoritative cross-client
  source would require carrying the snapshot on the shell snapshot or a
  dedicated account channel (server-side, not yet done).

### Arbitrary file attachments (not just images)

> **RETIRED 2026-08-31 — upstream now owns this.** Upstream shipped its own file
> attachments (#8235/#8236/#8237) as a strict superset: a real upload channel
> (50MB), video playback, needs-reattach markers, and an open `ChatAttachment`
> union with unknown-type passthrough. The fork's version was removed rather than
> re-applied. **Do not re-apply the items below on future merges** — take
> upstream's attachment code as-is. The section is kept only to explain what the
> fork used to carry. Still fork-owned nearby: the `thread.prompt.queue`
> attachment widening, and the `ClaudeAdapter` `kind` switch that ingests PDFs as
> document blocks and text files inline.

- Lets the composer accept **any** file type (PDF, JSON, CSV, logs, archives,
  …) via paste and drag-and-drop, not only images. Images keep their inline
  preview/zoom; non-image files render as a labelled chip (name + MIME type) in
  the composer and as a file card in the message timeline.
- This was originally landed in commit `288a124` ("Add support for file
  attachments"). A later `upstream/main` merge **partially reverted it**: the
  contracts, server, store, and timeline pieces survived, but the **web composer
  was clobbered back to images-only** (it rejected non-images with
  _"Unsupported file type … Please attach image files only."_). The notes below
  cover the full surface so the whole thing can be re-applied if a future merge
  reverts any layer again.
- Contracts (`packages/contracts/src/orchestration.ts`) — **modified**: adds
  `PROVIDER_SEND_TURN_MAX_ATTACHMENT_BYTES`, `ChatFileAttachment` /
  `UploadChatFileAttachment` schemas, and widens the `ChatAttachment` /
  `UploadChatAttachment` unions to include `type: "file"`.
- Server:
  - `apps/server/src/imageMime.ts` — `inferAttachmentExtension()` +
    `SAFE_ATTACHMENT_FILE_EXTENSIONS` (images plus pdf/csv/json/log/md/txt/
    xml/yaml/zip/tar/gz/…); falls back to `.bin`.
  - `apps/server/src/attachmentStore.ts` — `attachmentRelativePath()` uses
    `inferAttachmentExtension`; `resolveAttachmentPathById()` resolves by
    scanning the dir for `${id}.*` instead of a fixed image-extension list.
  - `apps/server/src/orchestration/Normalizer.ts` — accepts any MIME (not just
    `image/*`), picks the byte limit by image-vs-file, and persists
    `type: "file"` for non-image MIME.
  - `apps/server/src/attachmentContent.ts` — **fork-added**, shared by the
    provider adapters: `classifyAttachment()` (image / pdf / text / binary) and
    `formatTextAttachmentBlock()`, which inlines text files up to
    `ATTACHMENT_INLINE_MAX_BYTES` and otherwise truncates to a head preview that
    points at the on-disk path. The original file-attachment feature only
    handled upload/persistence; the adapters still dropped non-image files until
    this was added.
  - `apps/server/src/provider/Layers/ClaudeAdapter.ts` — **modified**: the
    attachment loop classifies via `attachmentContent.ts` instead of skipping
    `type !== "image"`. Images → image block, PDFs → `document` block, text →
    inlined text block, binary → a text note with the path. Mirrors Claude
    Code's behaviour.
  - `apps/server/src/provider/Layers/CodexAdapter.ts` +
    `CodexSessionRuntime.ts` — **modified**: Codex turn input has no
    document/file item type, so `resolveAttachment()` emits an `image` item for
    images and a `text` item (inlined contents, via `attachmentContent.ts`) for
    everything else. The runtime's `attachments` type was widened from
    `{type:"image"; url}` to `V2TurnStartParams__UserInput`.
- Web (the layer the merge reverted):
  - `apps/web/src/types.ts` — `ChatFileAttachment` interface + union.
  - `apps/web/src/composerDraftStore.ts` — `ComposerAttachment` union; the
    `ComposerImageAttachment` **alias is intentionally widened to the full
    union** (the merge had narrowed it to `Extract<…,{type:"image"}>`, which is
    what broke the composer). `previewUrl` is optional on file attachments, so
    dedup/revoke/hydrate all guard it; `hydrateImagesFromPersisted` rebuilds
    `image` vs `file` from the stored MIME type.
  - `apps/web/src/components/ChatView.logic.ts` — `cloneComposerImageForRetry`
    guards `image.type !== "image"` before touching `previewUrl`.
  - `apps/web/src/components/chat/ChatComposer.tsx` — **modified**: `isImageFile`
    helper + `ATTACHMENT_SIZE_LIMIT_LABEL`; `addComposerImages` no longer
    rejects non-images (it branches image-vs-file, picking the right byte limit
    and building a `type: "file"` attachment with no `previewUrl`);
    `onComposerPaste` forwards **all** files; the composer chip renders a
    name+MIME card for non-image attachments.
  - `apps/web/src/store.ts`, `apps/web/src/historyBootstrap.ts`,
    `apps/web/src/components/chat/MessagesTimeline.tsx` — map / summarize /
    render `file` attachments alongside images.
- Key smell test after a merge: if you see _"Please attach image files only"_
  in `ChatComposer.tsx` or `ComposerImageAttachment` aliased to an
  `Extract<…, { type: "image" }>`, the web layer has been reverted again —
  re-apply the web pieces above.

### Drag-and-drop folders onto the sidebar to add projects (2026-07-09)

- Dropping one or more OS folders onto the sidebar's projects area adds each as
  a project in the **primary (local) environment** and navigates to a new
  thread (reopens the project if the path already backs one). The absolute path
  of a dropped folder is only obtainable inside the Electron shell
  (`webUtils.getPathForFile`); plain browsers get an explanatory toast, and
  dropping non-folders toasts "only folders".
- **Merge seam — add-project logic extracted out of `CommandPalette.tsx`.** The
  palette's inline `handleAddProjectForEnvironment` body (~120 lines: path
  validation → existing-project dedupe → `project.create` dispatch → new-thread
  navigation → error toasts) now lives in the shared hook
  `apps/web/src/hooks/useAddProjectFromPath.ts` (returns a success boolean; the
  palette wraps it to close itself). If upstream edits that logic in
  `CommandPalette.tsx`, the merge will conflict on a deleted block — re-apply
  upstream's changes **inside the hook**, not by restoring the inline copy.
  Likewise `getEnvironmentBrowsePlatform` moved from `CommandPalette.tsx` to
  `apps/web/src/lib/environmentPlatform.ts`.
- Files:
  - `packages/contracts/src/ipc.ts` — **modified**: `getPathForFile(file)` on
    `DesktopBridge` and a `files.getPathForFile` section on `LocalApi` (sync,
    returns `string | null`).
  - `apps/desktop/src/preload.ts` — **modified**: implements `getPathForFile`
    via Electron `webUtils.getPathForFile` (null on empty path / throw).
  - `apps/web/src/localApi.ts` — **modified**: browser `files.getPathForFile`
    feature-detects `window.desktopBridge` (null without it), mirroring
    `dialogs.pickFolder`.
  - `apps/web/src/hooks/useAddProjectFromPath.ts` — **fork-added**: shared
    add-project-by-path logic (extracted from `CommandPalette.tsx`, see above).
  - `apps/web/src/hooks/useAddProjectDropZone.ts` — **fork-added**: drop-target
    hook (drag-depth tracking per `ChatComposer`'s pattern, synchronous
    `webkitGetAsEntry` directory detection during the drop event, sequential
    adds for multi-folder drops).
  - `apps/web/src/lib/environmentPlatform.ts` — **fork-added**:
    `getEnvironmentBrowsePlatform` (moved from `CommandPalette.tsx`).
  - `apps/web/src/components/CommandPalette.tsx` — **modified**: consumes the
    hook; `handleAddProjectForEnvironment` is now a thin close-on-success
    wrapper; the local `createProject` atom command and related imports were
    removed.
  - `apps/web/src/components/LegacySidebar.tsx` — **modified**:
    `SidebarProjectsContent` spreads `useAddProjectDropZone().dropZoneProps` onto its
    `<SidebarContent>` with an accent/ring highlight while a drop hovers. **Not yet
    ported to the default (v2-derived) sidebar** — folder drop-to-add-project is
    legacy-sidebar-only since the 2026-08-14 rename.
- Known limitation: on Windows, dropping a `\\wsl$\...` folder targets the
  local Windows environment (surfacing the server's validation error) instead
  of routing to the WSL backend like the palette's WSL-aware flow.

## 2026-06-30 upstream merge (parallel WSL backends + Legend List + preview) — notes

The `upstream/main` merge on 2026-06-30 (up to `a9b1190a1`, "Desktop: parallel WSL +
Windows backends with mode picker") brought a desktop backend-service refactor, a
Legend List scroll upgrade, and a `vite-plus` major bump. Fork-feature touch points:

- **macOS desktop build EMFILE — now fixed structurally in `asarUnpack`.** Upstream's
  WSL change made `scripts/build-desktop-artifact.ts` `asarUnpack` include
  `"**/node_modules/**"` (the WSL Linux Node reads node*modules off the real FS, not
  from asar). That unpacks the \_entire* node_modules tree on **every** platform. On
  macOS, electron-builder's (ad-hoc, unsigned) signing walk opens far more files than
  the runner's default 256-fd soft limit → `EMFILE: too many open files` (seen on
  `core-js` and `react-native` files). The earlier `ulimit -n 65536` band-aid in the
  mac CI steps proved **unreliable** — macOS clamps the soft limit to the per-process
  hard cap (`kern.maxfilesperproc`), so a react-native-sized unpacked tree still
  EMFILE'd. **Fix (current):** `createBuildConfig` now scopes `"**/node_modules/**"`
  to the **Windows** target only; mac/linux unpack just `DESKTOP_ASAR_UNPACK` (fff) +
  `apps/server/dist/**` + `**/node_modules/node-pty/**` (the only native module the
  primary loads off the real FS). This was previously feared risky ("mac/linux server
  bundle may rely on unpacked node_modules at runtime"), but that concern is unfounded:
  the primary backend runs via `ELECTRON_RUN_AS_NODE` (asar-aware) on **every** platform
  and resolves effect/@effect/\* straight out of `app.asar` — only the Windows WSL backend
  (`wsl.exe -- node`, can't read asar) needs the full tree on disk. See the comment on
  `asarUnpack` in `build-desktop-artifact.ts` and the test
  "unpacks the full node_modules tree only for the Windows WSL backend". The redundant
  `ulimit -n 65536` lines remain in `ci.yml`/`release.yml` mac steps (arm64 + x64) as a
  harmless defensive safety net; preserve them.
- **Electron download cache (`ci.yml` + `release.yml`).** Every desktop build job
  (mac arm64/x64, linux x64, windows x64) has an `actions/cache@v4` "Cache Electron
  download" step before the build, caching the per-OS Electron + electron-builder
  download dirs (`~/Library/Caches/{electron,electron-builder}` on mac,
  `~/.cache/{electron,electron-builder}` on linux,
  `~/AppData/Local/{electron/Cache,electron-builder/Cache}` on windows), keyed
  `electron-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('pnpm-lock.yaml') }}`
  with an `electron-<os>-<arch>-` restore-key fallback. Added because a transient
  GitHub release-CDN **502** while fetching `electron-v<ver>-darwin-x64.zip` failed a
  build; the cache makes the download a cold-start-only cost. These cache steps plus
  the `ulimit` lines are the intentional deviations of the fork workflows from the fork
  tip; preserve them.
- **`DesktopBackendManager` Context.Service was removed** in favor of
  `DesktopBackendPool` (multi-instance). `apps/desktop/src/updates/DesktopPayloadUpdates.ts`
  (payload hot-update) no longer restarts the backend in place: `apply`/`update` now
  only **arm** the staged payload by writing the `pending` pointer, and the IPC layer
  (`apps/desktop/src/ipc/methods/updates.ts`) triggers a full `DesktopLifecycle.relaunch`
  so the fresh launch promotes it. The old `pool.primary` → `instance.stop ; instance.start`
  hot-swap raced the loopback port against an in-flight session and stranded the renderer
  "Reconnecting…"; the payload service no longer depends on `DesktopBackendPool` at all.
  `DesktopUpdates.install`/`download` return a `requiresRelaunch` flag (also added to the
  `DesktopUpdateActionResult` contract) that the IPC handlers act on. If a future merge
  reshapes the pool API, there is no payload restart to repoint — keep the
  arm-then-relaunch split. (The electron installer path that previously restored the pool
  via `restartBackendPool` after a failed `quitAndInstall` was removed on 2026-07-01 — the
  payload channel is now the only in-app updater; see the payload feature section.)
- **Payload-aware backend entry resolution** moved into upstream's
  `resolvePrimaryStartConfig` (`DesktopBackendConfiguration.ts`). The fork's
  `entryPath = resolveActiveBackendEntryPath` is fed into upstream's new
  `args: [entryPath, "--bootstrap-fd", "3"]` **and** `entryPath`. Because the
  resolver reads the staged-payload pointer from disk, `buildWindowsPrimaryConfig`
  must `provideService(FileSystem.FileSystem, fileSystem)` — keep that provision.
- **`DesktopBackendOutputLog.{ts,test.ts}` were deleted upstream**; the logging
  service now lives in `DesktopObservability.ts` as `DesktopBackendOutputLogFactory`.
  The fork's `.a2code`/`A2 Code` log-path branding is env-derived (DesktopEnvironment)
  and covered by `DesktopEnvironment.test.ts`, so dropping the standalone test is safe.
- **Legend List upgrade vs in-chat find / work-log overflow.** Upstream's
  `MessagesTimeline.tsx` gained `getItemType`, `anchoredEndSpace`,
  `contentInsetEndAdjustment`, and moved work-log overflow expansion to a data-driven
  `work-toggle` row (dropping `WorkGroupSection`'s inline expand state). The fork's
  search wiring (host div + `{searchBar}` + `TimelineSearchCtx`, `data-chat-scroll-container`)
  was re-applied around the upgraded list; `searchExpanded` now only flows to
  `SimpleWorkEntryRow`. **`chatSearch.ts.getRowSearchText` must handle the new
  `work-toggle` row kind** (returns `""`) or its switch goes non-exhaustive.
- **Queued-prompt steering vs composer overlay.** Upstream rewrapped the composer
  in a `chat-composer-horizontal-inset` + shared-blur overlay and **removed**
  `shouldAutoScrollRef` / `scheduleStickToBottom` from `ChatComposer`. Re-inject the
  queue UI inside the new wrapper (before `<ChatComposer>`) and do **not** pass the
  removed props.

### Mobile vitest toolchain (`apps/mobile`, vite-plus version pairing)

- **The fork added `apps/mobile/src/vitest.d.ts`** (`declare module "vitest" { export
  - from "vite-plus/test"; }`) and pinned a `vitest`catalog alias to`@voidzero-dev/vite-plus-test`. This worked while `vite-plus`≤ 0.1.24, where`vite-plus/test` had concrete exports. **`vite-plus@0.2.x`made`vite-plus/test`do`export _ from 'vitest'`**, so the shim became a **circular re-export**
(`vitest`→`vite-plus/test`→`vitest`) that collapses every test helper
(`describe`/`it`/`expect`/`vi`) to nothing — ~270 `TS2305/TS2349`errors across
every mobile`_.test.ts`under mobile's`tsc`+`customConditions: ["react-native"]`
    (apps/web is unaffected because tsgo resolves without that condition).
- **Fix applied (2026-06-30):** deleted `apps/mobile/src/vitest.d.ts` (vite-plus@0.2.1
  bundles real `vitest@4.1.9`, so no shim is needed) and pinned
  `apps/mobile/package.json` → `"vitest": "4.1.9"` (the version `vite-plus@0.2.1`
  ships, so they dedupe). `pnpm-workspace.yaml` is kept **byte-identical to upstream**
  — no `vitest` catalog entry, no `vitest` override/peer rules. (Upstream dropped all
  of those precisely because 0.2.x self-provides vitest.)
- **Merge guard:** if a future merge re-bumps `vite-plus` and you see mobile test
  files reporting _"Module 'vite-plus/test' has no exported member 'describe'"_, check
  (1) `apps/mobile/src/vitest.d.ts` did not come back, and (2) `apps/mobile`'s pinned
  `vitest` matches the `vitest` version inside the new `vite-plus`
  (`grep '"vitest"' node_modules/.pnpm/vite-plus@*/node_modules/vite-plus/package.json`).
  The mobile tests pass at runtime regardless (`cd apps/mobile && bunx vitest run`); this
  seam is purely tsc type resolution.

## Recurring merge seams

### CI / release workflows (`.github/workflows/`)

- The fork **repurposed and trimmed** the GitHub Actions surface. It keeps only
  two workflow files; upstream ships more. This conflicts on most merges because
  both sides edit `ci.yml` / `release.yml` and upstream keeps adding workflows.
- Fork-intended state (preserve this when resolving):
  - `ci.yml` — repurposed as **"Build Artifacts"**: an Android preview APK job +
    unsigned desktop artifact jobs (macOS arm64/x64, Linux x64, Windows x64).
    **Drop** upstream's attempts to merge in `test` / `mobile_native_static_analysis`
    / preload-verification jobs — the fork's `ci.yml` is build-only.
  - `release.yml` — **"Release"**: separate per-platform jobs that each build an
    **unsigned** artifact. **Drop** upstream's matrix-based Azure Trusted Signing /
    Apple code-signing flow and the ImageMagick step. A dedicated **`build_payload`**
    job (on `ubuntu-24.04`) builds the **payload hot-update asset** (`vp run
build:desktop` → `vp run dist:payload:asset`, using the
    `T3CODE_PAYLOAD_SIGNING_KEY` secret) and uploads it as the `desktop-payload`
    artifact. The `release` job depends on `build_payload` (NOT the macOS build) and
    publishes `payload-*.tar.gz` + `payload-manifest.json`, so release creation is
    gated on the fast JS-only payload build rather than the slow desktop builds.
    Every desktop binary — including macOS arm64 — then attaches via an
    `append_<platform>` job that depends on `release`. Preserve this split when
    resolving — see the "Payload hot-update channel" feature above.
  - `mobile-eas-preview.yml` — **deleted in the fork** (the Android build lives in
    `ci.yml`). On a modify/delete conflict, keep it deleted (`git rm`).
  - `mobile-eas-production.yml` — **deleted in the fork** (upstream-added in the
    2026-07-08 merge window). Keep it deleted alongside `mobile-eas-preview.yml`.
  - Upstream-only workflows the fork does **not** carry: `deploy-relay.yml`,
    `issue-labels.yml`, `pr-size.yml`, `pr-vouch.yml`. Don't add them unless
    deliberately adopting them.
- **Consequence (intentional):** no fork workflow runs `vp check`, `vp run test`,
  or typecheck, so CI does not gate on tests/typecheck. Run those locally before
  merging (see the Merge checklist below). If we ever want CI gating, add a
  dedicated workflow rather than re-adopting upstream's `ci.yml` test job.
- Both `ci.yml` and `release.yml` carry two fork-local additions to the desktop
  build jobs (see the macOS EMFILE note above for the full rationale):
  - a **"Cache Electron download"** `actions/cache@v4` step before every desktop
    build (mac arm64/x64, linux x64, windows x64), hardening against transient
    GitHub release-CDN 502s; and
  - **`ulimit -n 65536`** before the two macOS `vp run dist:desktop:artifact` steps
    — now a defensive safety net rather than the primary EMFILE fix (that moved into
    `asarUnpack` scoping in `build-desktop-artifact.ts`).
- After resolving, confirm `git diff <fork-tip> HEAD -- .github/workflows` shows
  **only** those cache + `ulimit` additions (nothing else changed) and that no
  upstream-only workflow files were pulled in.
- 2026-06-24 merge note: upstream relay/deploy tests may assert release workflow
  relay tracing propagation (`relay-client-tracing-config`, `--github-env-file`
  env artifacts). Preserve the fork-trimmed `release.yml`; adjust those tests to
  assert the fork workflow remains independent of relay deployment outputs.

### File attachment support

- **No longer a seam as of 2026-08-31.** Upstream owns file attachments now, so
  take upstream's composer/timeline/contract code wholesale and re-apply nothing.
- Two things in this area are still fork-owned and _do_ need preserving:
  - `thread.prompt.queue` widened to
    `Schema.Union([UploadChatAttachment, ChatAttachment])` in
    `packages/contracts/src/orchestration.ts`, so a queued prompt can carry
    uploaded attachments.
  - the `ClaudeAdapter` attachment `kind` switch (PDF → document block, text →
    inline block), which upstream replaces with an image-only `continue`.
- Gotchas that bite when touching attachments:
  - The `ChatAttachment` union has an **open** member, so
    `attachment.type === "image"` does not narrow. Use `isImageAttachment` /
    `isFileAttachment` from `apps/web/src/types.ts`.
  - Attachment ids **carry their file extension**; mint them with
    `createAttachmentId(threadId, extension)`. `resolveAttachmentPathById` only
    probes image extensions as a fallback, so an extension-less id for a
    non-image file is unresolvable.

### Desktop Clerk auth callback

- File: `apps/desktop/src/ipc/methods/cloudAuth.test.ts`
- The fork keeps fork-specific desktop/app identity for side-by-side installs
  and easy visual differentiation from upstream, but the auth callback protocol
  was moved back to the upstream `t3code://auth/callback` scheme.
- Reason: the fork-specific `a2code://` callback was only introduced as a
  visual/workflow distinction while the upstream app was still installed on the
  same machine. That turned out to create avoidable compatibility friction with
  upstream mobile/web/cloud auth flows, while the actual side-by-side install
  safety comes from the fork-specific bundle/package/app IDs, not the callback
  scheme.
- Current rule: keep fork-specific bundle/package/app IDs and visible app name
  branding (`A2 Code`), but prefer the upstream `t3code` / `t3code-dev`
  protocol schemes unless there is a deliberate product reason to diverge again.
- Upstream may update the surrounding Clerk test structure or expected callback
  handling for web flows. Keep the fork-specific identity choices, but prefer
  upstream protocol literals when resolving conflicts unless the desktop auth
  flow itself is being redesigned.
- 2026-06-24 merge note: upstream added/updated tests around desktop build
  config and backend output log paths. Keep the fork package identity in those
  expectations too: packaged app id `com.amitbet.a2code`, protocol display name
  `A2 Code`, and user-data/log paths under `.a2code` / `A2 Code`.

### Claude SDK telemetry handling

- File: `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- **Obsolete as of the 2026-07-24 merge:** upstream now handles the SDK stream
  subtypes the fork used to no-op (`task_updated`, `api_retry`,
  `session_state_changed`, `notification`, and several consumed UX-internal
  subtypes), and the fork adopted that handling plus upstream's comprehensive
  subtype test. No fork-specific cases remain in this switch.
- Upstream may add adjacent cases in the same switch. Prefer upstream's
  handling unless there is a deliberate product decision to diverge in the
  UI.

### Client-vs-transport snapshot projection

- File: `apps/server/src/orchestration/ClientProjection.ts` (fork-added), used by
  `apps/server/src/ws.ts` and `apps/server/src/orchestration/http.ts`.
- `projectThreadSnapshotForClient(snapshot, deviceType)` is the **single** entry
  point for turning a stored thread-detail snapshot into the one a client
  receives. It runs upstream's transport-wide `projectThreadDetailSnapshot`
  (`ActivityPayloadProjection.ts`) and then the fork's mobile trimming (mobile
  clients do not receive `account.rate-limits.updated` activities; the matching
  event filter is `shouldSendThreadEventToClient`).
- **Merge seam:** upstream calls `projectThreadDetailSnapshot` directly at both
  snapshot sites. On conflict, keep the composed fork entry point rather than
  nesting the two calls per site — that is what keeps the mobile filter from
  being dropped. Because the composition always rebuilds the object,
  `ClientProjection.test.ts` asserts `toStrictEqual`, not `toBe`.

### Sidebar files (renamed 2026-08-14)

- `apps/web/src/components/Sidebar.tsx` is the **default** sidebar (upstream's former
  `SidebarV2.tsx`). `apps/web/src/components/LegacySidebar.tsx` is the old v1 sidebar,
  still reachable behind `useLegacySidebarEnabled()`. `SidebarV2.tsx` no longer exists.
- Fork behavior lives in both: machine scoping (`useMachineEnvironmentId` +
  `useEnvironmentProjects`/`useEnvironmentThreadShells`), the project todo sheet, and
  explicit-unread rows in the default one; the full v1 surface (fork/copy-ref/export,
  pin toggle, folder drop zone) in the legacy one.
- Per-thread menu actions belong in the shared
  `apps/web/src/components/threadActionMenu.logic.ts` builder and must be handled in
  **both** `Sidebar.tsx` and `apps/web/src/hooks/useThreadActionMenu.ts`.
- 2026-08-31: the project picker is now upstream's searchable `Combobox` driven by the
  `projectScopeMenuState` reducer — there is no `projectScopeMenuOpen` state any more. The fork's
  per-project todo button lives inside the `ComboboxItem` (guarded by `project ?`, since an item can
  have no project) and closes the popup with
  `dispatchProjectScopeMenu({ type: "open-changed", open: false })`.
- If upstream renames these again, redo the merge with `git merge-file` per the
  2026-08-14 notes rather than trusting git's rename detection.

### Chat timeline search wiring

- File: `apps/web/src/components/chat/MessagesTimeline.tsx`
- The fork adds in-chat find state, a `Cmd/Ctrl+F` keydown listener, and a
  fragment-wrapped render (the search bar is an absolutely-positioned sibling of
  the `LegendList`). Upstream changes to the timeline's render tree or to the
  `rows`/`listRef` plumbing may conflict. Preserve the search wiring (see the
  "In-chat find" feature above) when resolving, re-applying it on top of any
  upstream structural refactor.
- Same file also owns the `UserInputAnswerTimelineRow` render branch and its
  row classification lives in `MessagesTimeline.logic.ts` (see the "Answered
  user-input exchanges" feature above) — preserve both when resolving timeline
  conflicts.

### Thread forking orchestration

- Expected conflict area (see the "Thread forking" feature above for the full
  file list and per-file detail):
  - `packages/contracts/src/orchestration.ts` (command unions + `forkedFromId`)
  - `apps/server/src/orchestration/decider.ts` (`thread.fork` case)
  - `apps/server/src/orchestration/projector.ts`
  - `apps/server/src/orchestration/Layers/{ProjectionPipeline,ProjectionSnapshotQuery,ProviderCommandReactor}.ts`
  - `apps/server/src/persistence/{Services,Layers}/ProjectionThreads.ts` +
    `Migrations.ts` (migration registry)
  - `apps/server/src/provider/Layers/{ProviderService,CodexSessionRuntime}.ts`
  - `apps/web/src/components/threadActionMenu.logic.ts`,
    `apps/web/src/components/Sidebar.tsx`,
    `apps/web/src/components/LegacySidebar.tsx`,
    `apps/web/src/hooks/useThreadActionMenu.ts`,
    `apps/web/src/components/chat/ChatComposer.tsx`,
    `apps/web/src/composer-logic.ts`, `apps/web/src/hooks/useThreadActions.ts`
- Fork-specific concern: the user-facing flow hangs off `forkedFromId` in the
  projected thread detail and the shared thread-reference artifact path. On the
  fork's first user turn, `ProviderCommandReactor` must prepend the source as an
  implicit reference, de-duplicate it against explicit `@thread_ref` tokens,
  and pass every surviving reference through
  `createThreadContextArtifact`/`formatThreadContextPathInstructions`. Keep
  `forked_from_id` in the full-detail queries; shell queries intentionally omit
  it.
- Migration seam: `033_ProjectionThreadsForkedFrom` is fork-added. Fork ids
  33-35 are frozen because existing fork DBs already recorded them (see the
  2026-07-24 merge notes): when upstream adds a migration with id >= 33,
  renumber **upstream's** file/registry entry to the fork's next free id
  (upstream's 33/34 became the fork's 36/37; upstream's 35 became the fork's
  38 in the 2026-07-30 merge). Renumber the `.test.ts` and its
  `toMigrationInclusive` bounds too. The fork migrations are
  idempotent (guards on `PRAGMA table_info`), so re-running after a renumber
  is safe.
- Lower-level provider-native fork plumbing remains in
  `ProviderService`/`CodexSessionRuntime`, but the user-facing regular fork and
  queued-prompt Fork action deliberately do not select it. They both create a
  normal provider session and use the provider-neutral thread-reference
  artifact pipeline. Do not reintroduce a native-vs-replay branch in
  `ProviderCommandReactor` without also changing the documented uniform
  semantics and the same-provider/cross-provider/queued-prompt regression
  tests.

### Payload hot-update channel (desktop JS-only updates)

- **What it is.** A second desktop update path that ships _only_ the JS payload
  (`apps/server/dist` — the bundled server `bin.mjs` + chunks + the web `client/`
  it serves) as a GitHub release asset, so the app can swap front-end **and**
  back-end without replacing the signed/notarized `.app` shell via
  electron-updater. The renderer loads `t3code://app/` which proxies to the local
  backend, and the backend serves the bundled client — so swapping
  `apps/server/dist` swaps both ends at once.
- **Why it doesn't break Apple signing.** Payloads land in `stateDir`
  (`~/.a2code/userdata/payloads/<version>/`), never inside the `.app`, and they
  are JavaScript only (Gatekeeper/hardened-runtime enforce signatures on native
  Mach-O, not on JS loaded at runtime). The signed shell is untouched. Anything
  that needs a new **native** binary (the `@ff-labs/fff-bin-*` addon) or a new
  Electron/main-process build requires installing a fresh signed shell **by
  hand** (download the `.dmg`/`.exe`/`.AppImage` from the release) — the in-app
  electron-updater path has been removed (see "Sole update path" below). The
  manifest's `minShellVersion` gates payloads so an old shell stops pulling a JS
  payload that needs a newer native ABI; when it does, the user must reinstall
  the shell manually.
- **Apply model (fork UX, reworked 2026-06-30).** The payload **auto-downloads
  in the background** (poll → check → download → verify size + sha256 +
  **Ed25519 signature** → extract to `payloads/<version>.partial` → atomic
  rename), but the staged payload is **never activated automatically**: the
  `pending` pointer (promoted to `active` at the next backend start) is written
  **only when the user clicks apply**. So a plain app/backend restart can never
  silently apply a downloaded payload — only the disruptive step requires a
  click. Apply then restarts the **primary backend** (promotes pending→active);
  the renderer reconnects through the connection layer, so there is no window
  reload and no full app reinstall. The in-memory staged pointer lives in
  `DesktopPayloadUpdates`' `stagedPointerRef`. Resolution stays fault-tolerant:
  a missing/corrupt payload falls back to the shell-bundled backend, so a bad
  payload can't brick the app. (Replaces the old "promote on next backend start
  - `T3CODE_PAYLOAD_RESTART_ON_STAGE`" model, which auto-applied without consent.)
- **Security.** The app embeds an Ed25519 public key
  (`PAYLOAD_SIGNING_PUBLIC_KEY` in `payloadSigning.ts`, **filled in for the
  fork**); the release build signs with the `T3CODE_PAYLOAD_SIGNING_KEY` CI
  secret. With no embedded key the channel stays disabled in production unless
  `T3CODE_PAYLOAD_ALLOW_UNSIGNED=1` (dev only). **Keep the embedded key across
  merges** — emptying it disables in-place updates in production.
- **`minShellVersion` contract.** Defaults to `0.0.0` (any shell). Bump it via
  `T3CODE_PAYLOAD_MIN_SHELL_VERSION` whenever native deps / Electron change, so
  older shells stop pulling JS payloads that need a newer native ABI. This is
  the single most important operational lever — get it wrong and an old shell
  can load a payload its native modules can't run.
- **Sole update path — electron installer removed (fork, 2026-07-01).** The
  payload hot-update is now the **only** in-app update mechanism. The
  electron-updater integration was deleted entirely: there is no update feed, no
  background installer poller, no full-package auto-download, and no
  `quitAndInstall`. `DesktopUpdates` is a thin **payload-only facade** that maps
  the `DesktopPayloadUpdateState` onto the single renderer `DesktopUpdateState`
  via the pure `payloadUpdateStateToDesktopUpdateState()`
  (`payloadUpdateState.ts`). `DesktopUpdateState.kind` is therefore **always
  `"in-place"`** (the `"installer"` variant is retained in the contract but never
  emitted). `disabledReason` derives from the payload service's `enabled`/message.
  UX is unchanged and VSCode-style: the payload downloads silently (button hidden
  while downloading), then the button shows **"Restart to update"** → single
  click, no confirmation → arm + `DesktopLifecycle.relaunch`. `DesktopUpdates`
  subscribes to `DesktopPayloadUpdates.changes` to re-broadcast on the existing
  `UPDATE_STATE_CHANNEL`. **Merge note:** if upstream reworks the electron
  updater, do **not** re-wire it into `DesktopUpdates` — the fork ships shell
  updates only via a fresh manual install of the `.app`/installer (see signing
  note above). `setChannel` still persists the `latest`/`nightly` preference but
  no longer reconfigures any feed (the payload manifest URL is channel-agnostic).
- **Dual version display (fork, 2026-07-01).** Because the payload swaps the
  running content independently of the signed shell, both versions are surfaced:
  `DesktopUpdateState` gained a `shellVersion` field (native `.app` version)
  alongside `currentVersion` (running content = active payload, else shell). The
  in-app **Settings → About** row shows `Version <content> · app <shell>`, and the
  native OS About panel (`DesktopAppIdentity.setAboutPanelOptions`) sets
  `applicationVersion` = content version and folds the shell version + commit into
  the build line (`app <shell> · <commit>`). The panel reads the active payload at
  startup via `DesktopPayloadLayout.readActivePayloadVersion`; since applying a
  payload relaunches, that stays accurate. **Merge note:** `shellVersion` is a
  required field on `DesktopUpdateState` — keep it populated in
  `payloadUpdateState.ts` and in any `DesktopUpdateState` test fixtures.
- **Files (fork-added unless noted):**
  - `packages/shared/src/payloadArchive.ts` (+ `./payloadArchive` export) —
    dependency-free `.tar.gz` codec used by both the build script and the app.
  - `packages/contracts/src/ipc.ts` — **modified**: `DesktopPayloadManifest` +
    `DesktopPayloadUpdateState` schemas, plus `kind: "installer" | "in-place"`,
    `currentVersion` (running content), and `shellVersion` (native shell) on
    `DesktopUpdateState`.
  - `apps/desktop/src/updates/DesktopPayloadUpdates.ts` — the updater service
    (poll → check → **auto-download** → verify → stage; `download`/`apply`/`update`
    methods; `SubscriptionRef` state consumed by `DesktopUpdates`). Detection +
    download are automatic; **apply is user-initiated only** (writes the pending
    pointer then restarts the primary backend).
  - `apps/desktop/src/updates/payloadUpdateState.ts` — **fork-added**: pure
    `payloadUpdateStateToDesktopUpdateState(payload, { channel, runtimeInfo })`
    (always `kind: "in-place"` + status mapping), unit-tested in
    `payloadUpdateState.test.ts`. **Replaced** the old
    `updateMerge.ts`/`mergeDesktopUpdateState` (deleted with the installer).
  - `apps/desktop/src/updates/DesktopUpdates.ts` — **rewritten**: payload-only
    facade over `DesktopPayloadUpdates`; maps payload state onto
    `UPDATE_STATE_CHANNEL`, routes `download`/`install` to the payload service,
    and reports `requiresRelaunch`. No longer depends on `ElectronUpdater`,
    `DesktopBackendPool`, or `DesktopState`.
  - `apps/desktop/src/electron/ElectronUpdater.ts` (+ test),
    `apps/desktop/src/updates/updateMachine.ts` (+ test),
    `apps/desktop/src/updates/updateMerge.ts` (+ test) — **deleted**: the
    electron-installer wrapper and its installer-only state machine/merge are no
    longer used. `ElectronUpdater.layer` was removed from `main.ts`.
    (`DesktopState.markInstallRestart`/`clearInstallRestart` and the
    `DesktopLifecycle` before-quit `isInstallRestart()` guard are now unexercised
    but kept — they belong to the lifecycle quit handshake.)
  - `apps/web/src/components/desktopUpdate.logic.ts` +
    `apps/web/src/components/sidebar/SidebarUpdatePill.tsx` — **modified**:
    in-place is a single-click action with no confirmation popup, hidden while
    auto-downloading, success toast on apply.
  - `apps/desktop/src/updates/payloadLayout.ts` — pointer model + the
    `resolveActiveBackendEntryPath` resolver (pending→active promotion + bundled
    fallback).
  - `apps/desktop/src/updates/payloadSigning.ts` — Ed25519 verify + embedded key.
  - `apps/desktop/src/app/DesktopConfig.ts` — **modified**: payload env vars
    (`T3CODE_DISABLE_PAYLOAD_UPDATE`, `T3CODE_PAYLOAD_MANIFEST_URL`,
    `T3CODE_PAYLOAD_PUBLIC_KEY`, `T3CODE_PAYLOAD_ALLOW_UNSIGNED`). The old
    `T3CODE_PAYLOAD_RESTART_ON_STAGE` was **removed** (auto-apply is gone).
  - `apps/desktop/src/app/DesktopEnvironment.ts` — **modified**: `payloadsDir`,
    `activePayloadPointerPath`, `pendingPayloadPointerPath`,
    `bundledBackendEntryPath`.
  - `apps/desktop/src/backend/DesktopBackendConfiguration.ts` — **modified**:
    resolves the backend entry via `resolveActiveBackendEntryPath` so a
    stop/start restart applies a staged payload.
  - `apps/desktop/src/app/DesktopApp.ts`, `apps/desktop/src/main.ts` —
    **modified**: wire + start `DesktopPayloadUpdates`.
  - `apps/desktop/src/ipc/channels.ts` — **modified**: the payload state now
    rides the existing `UPDATE_STATE_CHANNEL`; the old
    `PAYLOAD_UPDATE_STATE_CHANNEL` was **removed**.
  - `scripts/build-payload-asset.ts` (+ root `dist:payload:asset` script) —
    builds `payload-<version>.tar.gz` + signed `payload-manifest.json`.
  - `.github/workflows/release.yml` — **modified**: builds + publishes the
    payload asset + manifest (see CI section).
- **Merge note:** the updater defaults its manifest URL to
  `https://github.com/amitbet/a2code/releases/latest/download/payload-manifest.json`
  (mirrors `DEFAULT_DESKTOP_UPDATE_REPOSITORY` in `build-desktop-artifact.ts`).
  Keep both pointing at the fork repo.

## Merge checklist

When pulling from `upstream/main`:

1. Check any conflict in the files above first.
2. Prefer upstream structural refactors, then re-apply the fork-specific
   behavior on top.
3. Preserve the fork CI surface (see "CI / release workflows" above). After
   resolving, confirm the workflows are byte-identical to the fork tip and no
   upstream-only workflow files were pulled in:
   - `git diff <fork-tip-before-merge> HEAD -- .github/workflows` is empty.
   - `ls .github/workflows` lists only `ci.yml` and `release.yml`.
4. Run `bunx vp check`.
5. Run `bunx vp run typecheck`.
6. Because CI does not gate on tests, run `bunx vp run test` locally and confirm
   the fork-feature suites pass before pushing the merge.
