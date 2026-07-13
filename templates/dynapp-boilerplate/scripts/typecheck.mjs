import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, "app.json"), "utf8"));

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
