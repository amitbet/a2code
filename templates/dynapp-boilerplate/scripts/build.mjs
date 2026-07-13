import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

await mkdir(join(root, "content/assets"), { recursive: true });
await copyFile(join(root, "src/main.js"), join(root, "content/assets/app.js"));
await copyFile(join(root, "src/styles.css"), join(root, "content/assets/app.css"));
await copyFile(join(root, "public/icon.svg"), join(root, "content/assets/icon.svg"));
await writeFile(
  join(root, "content/index.html"),
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
