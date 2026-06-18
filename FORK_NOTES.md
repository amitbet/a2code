# FORK_NOTES.md

This file tracks fork-specific divergences that are likely to conflict when
merging `upstream/main`.

## Fork features

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

### Thread forking (`/fork` + context menu)

- Creates a new thread that inherits the source thread's provider conversation
  context, staying in the **same git environment** (same project, model, runtime
  mode, branch, worktree — no new worktree, no subthread runtime model).
- Entry points (both fork-added):
  - sidebar thread context-menu action: **`Fork thread`**
  - composer slash command: **`/fork`** (only offered on a started server
    thread, not on a draft — a draft has no context to fork)
- **Implementation approach actually taken (supersedes the earlier "copied
  messages + bootstrap" plan that was sketched here):** the fork rides the
  existing provider resume-cursor plumbing and calls the Codex app-server's
  native **`thread/fork`** RPC on the new thread's first session start, instead
  of `thread/start`. The cursor carries `{ threadId: <source conversation id>,
fork: true }`; the runtime forks the source conversation into a brand-new
  backend thread, then stores a normal resume cursor so subsequent starts just
  resume. Fork happens exactly once (only when the new thread has no cursor of
  its own yet).
  - Reason for choosing provider-native fork over copied-messages+bootstrap:
    it reuses machinery that already flows end-to-end (resume cursor →
    `ProviderService.startSession` → `CodexAdapter` → `CodexSessionRuntime`),
    so it touches far less surface and needs no synthetic bootstrap turn.
  - Consequence / scope limit: this is **Codex-only**. The generic provider
    adapter contract has no cross-provider fork. For a non-Codex source the
    fork cursor's `{ threadId }` shape won't match that adapter's resume state,
    so it degrades to a fresh (empty-context) thread rather than erroring.
- **Known open item (verify at runtime):** the agent's context is forked, but
  the orchestration-level message history (the visible transcript) is a separate
  projection and is **not** copied by this change. Whether the prior messages
  render in the new thread depends on whether `ProviderRuntimeIngestion` replays
  the `thread/fork` response's historical turns (same situation as
  `thread/resume`). If a forked thread looks empty but the agent clearly retains
  context, the fix lives in `ProviderRuntimeIngestion`.
- Files:
  - `packages/contracts/src/orchestration.ts` — **modified**: `ThreadForkCommand`
    (`thread.fork`: new `threadId`, `sourceThreadId`, `title`), added to both
    command unions; `forkedFromId` added to `OrchestrationThread` (optional) and
    `ThreadCreatedPayload` (optional).
  - `packages/contracts/src/provider.ts` — **modified**: `forkFromThreadId` on
    `ProviderSessionStartInput`.
  - `apps/server/src/orchestration/decider.ts` — **modified**: `thread.fork`
    case validates source exists / new absent, copies source metadata, and
    emits a `thread.created` event tagged with `forkedFromId` (no new event
    type — reuses `thread.created`).
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
    `{ threadId, fork: true }` cursor (`readResumeCursorThreadId` helper).
  - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` —
    **modified**: passes `forkFromThreadId` on the first session start when the
    thread has `forkedFromId`.
  - `apps/server/src/provider/Layers/CodexSessionRuntime.ts` — **modified**:
    `CodexResumeCursorSchema` gains optional `fork`; `openCodexThread` adds a
    `thread/fork` branch; `CodexThreadOpenMethod`/`CodexThreadOpenResponse`
    include `thread/fork`; `readForkCursorThreadId` helper.
  - `apps/web/src/hooks/useThreadActions.ts` — **modified**: `forkThread` action
    (dispatch `thread.fork`, wait for the new thread to project, navigate).
  - `apps/web/src/components/Sidebar.tsx` — **modified**: `Fork thread` menu
    item + threads `forkThread` through the sidebar prop chain.
  - `apps/web/src/components/chat/ChatComposer.tsx` +
    `apps/web/src/composer-logic.ts` — **modified**: `/fork` slash command
    (`"fork"` added to `ComposerSlashCommand`) and its handler.

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
  - `apps/web/src/store.ts` — **modified**: adds
    `selectLatestRateLimitActivitiesForInstance(instanceId)`, which returns the
    latest `account.rate-limits.updated` activity for every thread bound to a
    provider instance, across all environments (WeakMap-cached per thread on the
    activity-id array). This is the account/subscription-wide source for the
    meter — quota is an account property, not a per-conversation one.
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

## Recurring merge seams

### File attachment support

- Expected conflict area (see the "Arbitrary file attachments" feature above
  for the full file list). The server/contracts pieces tend to survive upstream
  merges; the **web composer is the fragile part** — upstream composer/image
  refactors keep narrowing it back to images-only.
- When resolving: keep upstream's composer/timeline structural changes, then
  re-apply (1) the widened `ComposerImageAttachment` alias, (2) the
  branch-on-`isImageFile` logic in `addComposerImages`, (3) the unfiltered
  `onComposerPaste`, and (4) the `attachment.type === "image"` / `previewUrl`
  guards wherever image-only behaviour is assumed.

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

### Claude SDK telemetry handling

- File: `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- The fork currently keeps some SDK telemetry cases as silent no-ops:
  `thinking_tokens`, `task_updated`, and `api_retry`.
- Upstream may add adjacent cases in the same switch. Preserve the fork behavior
  unless there is a deliberate product decision to surface those events in the
  UI.

### Chat timeline search wiring

- File: `apps/web/src/components/chat/MessagesTimeline.tsx`
- The fork adds in-chat find state, a `Cmd/Ctrl+F` keydown listener, and a
  fragment-wrapped render (the search bar is an absolutely-positioned sibling of
  the `LegendList`). Upstream changes to the timeline's render tree or to the
  `rows`/`listRef` plumbing may conflict. Preserve the search wiring (see the
  "In-chat find" feature above) when resolving, re-applying it on top of any
  upstream structural refactor.

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
  - `apps/web/src/components/Sidebar.tsx`,
    `apps/web/src/components/chat/ChatComposer.tsx`,
    `apps/web/src/composer-logic.ts`, `apps/web/src/hooks/useThreadActions.ts`
- Fork-specific concern: the flow hangs off the provider **resume-cursor**
  path and the Codex `thread/fork` RPC. When merging upstream session/provider
  refactors, the cursor must keep flowing
  `ProviderService.startSession → CodexAdapter → CodexSessionRuntime`, and
  `openCodexThread` must keep the `fork` branch ahead of the `start`/`resume`
  branches. The fork must remain one-shot (only when the new thread has no
  cursor of its own).
- Migration seam: `033_ProjectionThreadsForkedFrom` is fork-added. If upstream
  adds its own migration `33`, renumber ours to the next free id (and update
  `Migrations.ts`). The migration is idempotent (guards on `PRAGMA
table_info`), so re-running after a renumber is safe.
- If the provider adapter contract ever gains a first-class cross-provider fork
  API, this Codex-only cursor hack can be replaced by it.

## Merge checklist

When pulling from `upstream/main`:

1. Check any conflict in the files above first.
2. Prefer upstream structural refactors, then re-apply the fork-specific
   behavior on top.
3. Run `bunx vp check`.
4. Run `bunx vp run typecheck`.
