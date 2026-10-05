import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { makePayloadModuleResolutionImport } from "./payloadModuleResolution.ts";

const writePackage = Effect.fn("writePackage")(function* (
  directory: string,
  manifest: Record<string, string>,
  source: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* fs.writeFileString(path.join(directory, "package.json"), JSON.stringify(manifest));
  yield* fs.writeFileString(path.join(directory, "index.js"), source);
});

it.layer(NodeServices.layer)("payloadModuleResolution", (it) => {
  it.effect("resolves a payload's external imports and requires from the shell", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "a2-payload-resolution-" });
      const shellRoot = path.join(root, "app.asar");
      const bundledEntryPath = path.join(shellRoot, "apps/server/dist/bin.mjs");
      const payloadsDir = path.join(root, "payloads");
      const payloadEntryPath = path.join(payloadsDir, "1.2.4", "bin.mjs");
      yield* fs.makeDirectory(path.dirname(bundledEntryPath), { recursive: true });
      yield* fs.writeFileString(bundledEntryPath, "");
      yield* writePackage(
        path.join(shellRoot, "node_modules/esm-external"),
        { name: "esm-external", type: "module", exports: "./index.js" },
        'export const value = "esm";\n',
      );
      yield* writePackage(
        path.join(shellRoot, "node_modules/cjs-external"),
        { name: "cjs-external", main: "index.js" },
        'module.exports = { value: "cjs" };\n',
      );
      yield* fs.makeDirectory(path.dirname(payloadEntryPath), { recursive: true });
      yield* fs.writeFileString(
        payloadEntryPath,
        [
          'import { createRequire } from "node:module";',
          'import { value } from "esm-external";',
          "const require = createRequire(import.meta.url);",
          "let missing = 'resolved';",
          "try { require('not-installed-anywhere'); } catch (error) { missing = error.code; }",
          "console.log(JSON.stringify([value, require('cjs-external').value, missing, import.meta.main]));",
        ].join("\n"),
      );

      const output = yield* spawner.string(
        ChildProcess.make(process.execPath, [
          "--import",
          makePayloadModuleResolutionImport({ bundledEntryPath, payloadsDir }),
          payloadEntryPath,
        ]),
      );

      // The payload stays the main module, which the server's entrypoint check needs.
      assert.deepEqual(JSON.parse(output.trim()), ["esm", "cjs", "MODULE_NOT_FOUND", true]);
    }).pipe(Effect.scoped),
  );
});
