import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

await NodeFSP.mkdir(NodePath.join(root, "content/assets"), { recursive: true });
await NodeFSP.copyFile(
  NodePath.join(root, "src/main.js"),
  NodePath.join(root, "content/assets/app.js"),
);
await NodeFSP.copyFile(
  NodePath.join(root, "src/styles.css"),
  NodePath.join(root, "content/assets/app.css"),
);
await NodeFSP.copyFile(
  NodePath.join(root, "public/icon.svg"),
  NodePath.join(root, "content/assets/icon.svg"),
);
await NodeFSP.writeFile(
  NodePath.join(root, "content/index.html"),
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
