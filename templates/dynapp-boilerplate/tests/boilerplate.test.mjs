import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

await NodeFSP.access(NodePath.join(root, "app.json"));
await NodeFSP.access(NodePath.join(root, "LICENSE"));
await NodeFSP.access(NodePath.join(root, "README.md"));
await NodeFSP.access(NodePath.join(root, "content/index.html"));
await NodeFSP.access(NodePath.join(root, "src/main.js"));

const manifest = JSON.parse(await NodeFSP.readFile(NodePath.join(root, "app.json"), "utf8"));

if (manifest.id !== "dynapp-boilerplate") {
  throw new Error("Unexpected boilerplate app id");
}

if (manifest.backendPermissions.length !== 0) {
  throw new Error("Boilerplate should not request shell permissions");
}
