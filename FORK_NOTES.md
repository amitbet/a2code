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

### Thread branching (`/branch` + context menu)

- Planned fork feature: create a new thread from the current thread while
  preserving prior conversational context, without introducing worktree
  isolation or a subthread runtime model in V1.
- Intended entry points:
  - a built-in composer slash command: `/branch`
  - a sidebar thread context-menu action: `Branch thread`
- Design choice: do not treat existing `chat.new` behavior as sufficient.
  Reason: `chat.new` preserves branch/worktree selection, but it does not
  preserve provider conversation context.
- Design choice: do not make provider-native fork support the primary V1 path.
  Reason: Codex app-server exposes `thread/fork`, but the generic provider
  adapter contract does not. A provider-native implementation would either
  become Codex-only or force a wider provider abstraction change.
- Current implementation direction:
  - extend `thread.create` so a new thread can be seeded with copied messages
  - add a one-time provider context bootstrap string on the new thread
  - render copied history immediately in the branched thread
  - inject the bootstrap into the first real provider send for that new thread
  - clear the bootstrap after first use so the thread behaves normally
- Reason for copied messages + bootstrap:
  Reason: copied messages preserve visible history for the user, while the
  bootstrap ensures the provider actually receives inherited context on the
  first turn.
- Reason for avoiding subthreads / side-runs in V1:
  Reason: the current architecture is thread-centric, and nested runtime
  lifecycles would be much more invasive than the UX requires.

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

### Thread branching orchestration

- Expected conflict area:
  - `packages/contracts/src/orchestration.ts`
  - `apps/server/src/orchestration/decider.ts`
  - `apps/server/src/orchestration/projector.ts`
  - `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
  - `apps/web/src/components/Sidebar.tsx`
  - `apps/web/src/components/chat/ChatComposer.tsx`
  - shared thread-creation helpers in `apps/web/src`
- Fork-specific concern: the branch flow needs both visible copied history and
  a one-time provider bootstrap so the new thread starts with inherited context.
- When merging upstream thread/session refactors, preserve that two-part model
  unless the provider adapter contract gains a first-class cross-provider fork
  API.

## Merge checklist

When pulling from `upstream/main`:

1. Check any conflict in the files above first.
2. Prefer upstream structural refactors, then re-apply the fork-specific
   behavior on top.
3. Run `bunx vp check`.
4. Run `bunx vp run typecheck`.
