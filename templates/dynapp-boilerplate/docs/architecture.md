# Architecture

The boilerplate uses three layers:

- `app.json`: Package metadata, scripts, targets, and backend permissions.
- `src/`: Editable source owned by the DynApp.
- `content/`: Built browser content loaded by the shell.

The app does not call shell capabilities by default. If it later uses
`window.appShell`, every capability must be declared in `app.json` before the
shell can grant it.
