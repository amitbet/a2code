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
    `"spend"`; `deriveLatestRateLimitSnapshot` merges windows across activities;
    `shouldShowRateLimitMeter` gates visibility.
  - `apps/web/src/components/chat/RateLimitMeter.tsx` — fork-added. Renders the
    bars + popover (including the spend `detail` dollar string).
  - `apps/web/src/components/chat/ChatComposer.tsx` — **modified**: imports
    `RateLimitMeter` + `deriveLatestRateLimitSnapshot`/`shouldShowRateLimitMeter`,
    derives `activeRateLimits` via `useMemo`, passes it into
    `ComposerFooterPrimaryActions`, and renders `<RateLimitMeter>`. This is the
    wiring upstream merges keep clobbering — re-apply it on top of any upstream
    composer-footer refactor.
- Note: the Claude spend window only renders if the usage endpoint returns a
  numeric `extra_usage.utilization` and `is_enabled !== false` (see
  `spendWindow()` in `ClaudeUsageApi.ts`).

## Recurring merge seams

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
