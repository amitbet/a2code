# T3 Code

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, and OpenCode. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

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
    another avenue without disturbing the original. Every fork treats its source
    as an implicit thread reference: on the fork's first message, the complete
    settled source transcript is serialized to disk and the agent is instructed
    to read it before answering. This is provider-neutral and uses the same
    context path as an explicit thread reference. Available from the thread
    right-click menu (**Fork thread**), the **`/fork`** composer command, and the
    queued-prompt **Fork** action.
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
> T3 Code currently supports Codex, Claude, Cursor, Grok Build and OpenCode. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Try it out (install-free)

The easiest way to test T3 Code is to run the server in your terminal (requires Node.js 22.16+, 23.11+, or 24.10+):

```bash
npx t3@latest
```

This will launch T3 Code's backend on your machine as well as the local web app to control your agents.

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

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Customize a project icon](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- Linux: [run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

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
