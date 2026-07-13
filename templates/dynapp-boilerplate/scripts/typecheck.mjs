import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await NodeFSP.readFile(NodePath.join(root, "app.json"), "utf8"));

const required = ["schemaVersion", "id", "name", "version", "backendPermissions"];
for (const field of required) {
  if (!(field in manifest)) {
    throw new Error(`app.json is missing required field: ${field}`);
  }
}

if (manifest.schemaVersion !== 2) {
  throw new Error("app.json schemaVersion must be 2");
}

if (!Array.isArray(manifest.backendPermissions)) {
  throw new Error("app.json backendPermissions must be an array");
}
