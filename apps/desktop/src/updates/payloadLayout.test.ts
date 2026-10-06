import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopPayloadLayout from "./payloadLayout.ts";

const environmentLayer = (baseDir: string) =>
  DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/Applications/A2 Code.app/Contents/Resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        DesktopConfig.layerTest({ T3CODE_HOME: baseDir, T3CODE_MODE: "desktop" }),
      ),
    ),
  );

const pointer = (version: string) =>
  `{"version":"${version}","minShellVersion":"1.2.3","sha256":"abc","stagedAt":"2026-10-06T00:00:00.000Z"}`;

/** Runs `check` against a temp T3 home after writing `files` (paths relative to the payloads dir). */
const withPayloads = (
  files: Record<string, string>,
  check: (
    environment: DesktopEnvironment.DesktopEnvironment["Service"],
  ) => Effect.Effect<void, never, FileSystem.FileSystem | DesktopEnvironment.DesktopEnvironment>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-payload-layout-" });
    yield* Effect.gen(function* () {
      const environment = yield* DesktopEnvironment.DesktopEnvironment;
      for (const [relative, content] of Object.entries(files)) {
        const filePath = path.join(environment.payloadsDir, relative);
        yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
        yield* fileSystem.writeFileString(filePath, content);
      }
      yield* check(environment);
    }).pipe(Effect.provide(environmentLayer(baseDir)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("resolveActiveClientAssetsDir", () => {
  it.effect("serves the bundled client when no payload is active", () =>
    withPayloads({}, (environment) =>
      Effect.gen(function* () {
        const dir = yield* DesktopPayloadLayout.resolveActiveClientAssetsDir;
        assert.strictEqual(dir, environment.clientAssetsDir);
      }),
    ),
  );

  it.effect("serves the active payload's client", () =>
    withPayloads(
      {
        "active.json": pointer("1.2.5"),
        "1.2.5/bin.mjs": "",
        "1.2.5/client/index.html": "<html></html>",
      },
      (environment) =>
        Effect.gen(function* () {
          const dir = yield* DesktopPayloadLayout.resolveActiveClientAssetsDir;
          assert.strictEqual(
            dir,
            environment.path.join(environment.payloadsDir, "1.2.5", "client"),
          );
        }),
    ),
  );

  it.effect("promotes a pending payload so the window matches the backend it launches", () =>
    withPayloads(
      {
        "active.json": pointer("1.2.4"),
        "1.2.4/bin.mjs": "",
        "1.2.4/client/index.html": "<html></html>",
        "pending.json": pointer("1.2.5"),
        "1.2.5/bin.mjs": "",
        "1.2.5/client/index.html": "<html></html>",
      },
      (environment) =>
        Effect.gen(function* () {
          const dir = yield* DesktopPayloadLayout.resolveActiveClientAssetsDir;
          assert.strictEqual(
            dir,
            environment.path.join(environment.payloadsDir, "1.2.5", "client"),
          );
          const entry = yield* DesktopPayloadLayout.resolveActiveBackendEntryPath;
          assert.strictEqual(
            entry,
            DesktopPayloadLayout.payloadVersionEntryPath(environment, "1.2.5"),
          );
        }),
    ),
  );

  it.effect("falls back to the bundled client when the payload has no client", () =>
    withPayloads({ "active.json": pointer("1.2.5"), "1.2.5/bin.mjs": "" }, (environment) =>
      Effect.gen(function* () {
        const dir = yield* DesktopPayloadLayout.resolveActiveClientAssetsDir;
        assert.strictEqual(dir, environment.clientAssetsDir);
      }),
    ),
  );
});
