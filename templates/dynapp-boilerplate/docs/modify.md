# Modification Guide

Start with `src/main.js` and `src/styles.css`. Keep app behavior in source files,
then run `npm run build` to regenerate `dist/`.

When adding shell access:

- Add the permission to `app.json`.
- Use the narrowest scope that works.
- Add a plain-language reason.
- Update `README.md` and `CHANGES.md`.

When this app is a fork, update `FORK_NOTES.md` with implementation details that
help future merges preserve local features.
