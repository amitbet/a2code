import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

await mkdir(join(root, "dist/assets"), { recursive: true });
await copyFile(join(root, "src/main.js"), join(root, "dist/assets/app.js"));
await copyFile(join(root, "src/styles.css"), join(root, "dist/assets/app.css"));
await writeFile(
  join(root, "dist/index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DynApp Boilerplate</title>
    <link rel="stylesheet" href="./assets/app.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./assets/app.js"></script>
  </body>
</html>
`,
);
