# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex, Claude, Cursor, and OpenCode, more coming soon).

## About this fork

This is a fork of [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) that
adds the features below on top of upstream. Fork-specific app identity
(`A2 Code` name + bundle/package IDs) lets it install side-by-side with the
upstream app.

- **Thread artifacts** — a thread's _completed_ history can be serialized into a
  portable Markdown transcript: user/assistant messages interleaved with the
  tool steps the agent actually ran (the command/file/search call **and its
  result**), in order. It deliberately leaves out work that isn't done — the
  in-flight turn that's still running and proposed-but-unexecuted plans — so the
  artifact represents settled work, not a half-finished state. Generated
  context is persisted in full and the agent receives a mandatory path-reading
  instruction instead of a large inline preview.
  - **Fork** creates a new thread in the same git environment so you can explore
    another avenue without disturbing the original. When the fork stays on a
    provider that can branch its own conversation natively (Codex), it does
    that — a lossless continuation. Otherwise (and for **any cross-provider
    fork**, e.g. Codex→Claude) it carries the source context forward as a
    serialized on-disk transcript referenced by the fork's first message. From
    the thread right-click menu (**Fork thread**) and the **`/fork`** composer
    command; to switch model/provider on a fork today, pick the target in the
    composer's model picker before sending the first message.
  - **Reference** pulls one thread's context into another conversation. Use the
    thread right-click **Copy thread ref** action to copy an `@thread_ref:<id>`
    token, paste it into any thread's message, and on send the server stores that
    thread's transcript and tells the agent to read its path — including across
    models/providers.
  - **Export** downloads a thread as a zip — `transcript.md` plus every
    attachment under `attachments/` — via the thread right-click **Export
    thread (zip)** action, so the context can move to another checkout,
    machine, or external agent.
- **Queued prompt steering** — sending while a thread is running **queues** the
  prompt instead of interrupting; each queued prompt can be removed or promoted
  with **Steer** to send it to the active agent mid-flight. When the session goes
  idle, queued prompts drain FIFO as normal next turns. Provider-neutral across
  Codex, Claude, Cursor, Grok, and OpenCode.
- **In-chat find (`Cmd/Ctrl+F`)** — a browser-style find toolbar over the chat
  timeline that searches the underlying row data (the timeline is virtualized,
  so native find-in-page can't see it), scrolls matches into view, and
  highlights them.
- **Live provider quota meter** — composer-footer bars for provider rate-limit /
  quota usage: Claude session (5h), weekly (incl. Opus/Sonnet splits), a spend
  bar (`$used / $limit`), and Codex 5h/weekly windows.
- **Arbitrary file attachments** — attach any file type (PDF, JSON, CSV, logs,
  archives, …), not just images, by pasting or dragging it into the composer.
  Images keep their inline preview; other files show as a labelled chip.
- **One-click in-place desktop updates** — the desktop app hot-swaps its JS
  payload (bundled server + web client) without a full reinstall. New versions
  **auto-download in the background**, then the sidebar **Update available**
  button applies them with a **single click and no confirmation dialog**
  (VSCode-style) by quickly restarting the backend. Nothing is applied until you
  click, and updates that need a newer native shell fall back to the full
  installer automatically.

For the full per-feature breakdown, the files each feature touches, and guidance
on preserving these changes when merging `upstream/main`, see
[FORK_NOTES.md](./FORK_NOTES.md).

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, and OpenCode.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `cursor-agent login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Run without installing

```bash
npx t3@latest
```

Tip: Use `npx t3@latest --help` for the full CLI reference.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

There's no public docs site yet, checkout the miscellaneous markdown files in [docs](./docs).

## Documentation

- [Getting started](./docs/getting-started/quick-start.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Provider guides](./docs/providers/codex.md)
- [Operations](./docs/operations/ci.md)
- [Reference](./docs/reference/encyclopedia.md)

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
