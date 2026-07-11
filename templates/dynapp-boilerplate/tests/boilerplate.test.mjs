import { access, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

await access(join(root, "app.json"));
await access(join(root, "LICENSE"));
await access(join(root, "README.md"));
await access(join(root, "dist/index.html"));
await access(join(root, "src/main.js"));

const manifest = JSON.parse(await readFile(join(root, "app.json"), "utf8"));

if (manifest.id !== "com.dynapp.boilerplate") {
  throw new Error("Unexpected boilerplate app id");
}

if (manifest.permissions.length !== 0) {
  throw new Error("Boilerplate should not request shell permissions");
}
