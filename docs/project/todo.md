# TODO

## Small things

- [ ] Submitting new messages should scroll to bottom
- [ ] Only show last 10 threads for a given project
- [ ] Thread archiving
- [ ] New projects should go on top
- [ ] Projects should be sorted by latest thread update

## Bigger things

- [ ] Queueing messages

## Thread Fork Notes

- Current scope: lightweight `/branch` support plus a thread context-menu action.
- Goal: create a new thread that keeps the old conversational context while staying in the same project/environment and same worktree selection.
- Decision: do not introduce subthreads, side-runs, or worktree isolation for V1.
  Reason: the existing architecture is thread-centric, and adding nested runtime lifecycles would be much more invasive than the UX requires.
- Decision: do not rely on `chat.new` alone.
  Reason: it preserves branch/worktree selection, but it does not preserve provider conversation context.
- Decision: do not treat provider-native fork support as the primary V1 path.
  Reason: Codex app-server exposes `thread/fork`, but the generic provider adapter contract does not, so a provider-native solution would either be Codex-only or would force a wider provider abstraction change.
- Planned implementation direction:
  1. Extend `thread.create` so a new thread can be seeded with copied messages plus a one-time provider context bootstrap string.
  2. Show the copied history immediately in the new thread.
  3. Consume the bootstrap string on the first real provider send, then clear it.
  4. Route both `/branch` and the sidebar context-menu action through the same helper.
- Reason for copied messages + bootstrap:
  Reason: copied messages preserve visible history for the user, while the bootstrap ensures the provider actually receives the inherited context on the first turn.
- Reason for one-time bootstrap instead of permanent hidden state:
  Reason: once the new thread has started its own provider session, inherited context should stop mutating future sends and the thread should behave like a normal thread again.
- UI entry points to add:
  - `/branch` as a built-in composer slash command
  - `Branch thread` in the sidebar thread context menu
- Follow-up consideration:
  Reason: if we later want true provider-native branching, the next clean step is extending the provider adapter/service contract with an explicit fork operation rather than embedding Codex-only logic in the web layer.
