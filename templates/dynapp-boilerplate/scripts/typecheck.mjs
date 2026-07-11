import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, "app.json"), "utf8"));

const required = ["schemaVersion", "id", "name", "version", "entry", "permissions"];
for (const field of required) {
  if (!(field in manifest)) {
    throw new Error(`app.json is missing required field: ${field}`);
  }
}

if (!Array.isArray(manifest.permissions)) {
  throw new Error("app.json permissions must be an array");
}

if (!manifest.entry?.html) {
  throw new Error("app.json entry.html is required");
}
