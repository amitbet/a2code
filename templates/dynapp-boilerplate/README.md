# DynApp Boilerplate

This is the default starting point for a new DynApp. It is intentionally small:
plain browser JavaScript, no dependencies, no requested shell permissions, and a
complete package shape that A2 Code can inspect and modify.

## Usage

Run the declared scripts from this directory:

```sh
npm run build
npm test
npm run typecheck
```

The shell loads `content/index.html`. A2 Code edits the source in `src/`, then
runs the declared build script to refresh `content/`.

## Permissions

This boilerplate requests no shell capabilities:

```json
"backendPermissions": []
```

Add permission objects only when the app needs shell access, and include a
specific user-facing `reason` for each permission.
