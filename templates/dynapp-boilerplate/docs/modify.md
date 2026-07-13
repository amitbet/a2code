# Modification Guide

Start with `src/main.js` and `src/styles.css`. Keep app behavior in source files,
then run `npm run build` to regenerate `content/`.

When adding shell access:

- Add the permission to `app.json`.
- Request only the specific permission needed by the feature.
- Add a plain-language reason.
- Update `README.md` and `CHANGES.md`.

When this app is a fork, update `FORK_NOTES.md` with implementation details that
help future merges preserve local features.
