import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopPayloadUpdates from "./DesktopPayloadUpdates.ts";

const baseDir = "/tmp/t3-desktop-payload-updates-test";
const pendingPointerPath = `${baseDir}/userdata/payloads/pending.json`;
const activePointerPath = `${baseDir}/userdata/payloads/1.2.4/bin.mjs`;
const activePayloadPointerPath = `${baseDir}/userdata/payloads/active.json`;

const makePayloadLayer = (payloadFiles: Record<string, string>) =>
  DesktopPayloadUpdates.layer.pipe(
    Layer.provideMerge(
      FileSystem.layerNoop({
        exists: (path) => Effect.succeed(payloadFiles[path] !== undefined),
        readFileString: (path) =>
          payloadFiles[path] === undefined
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "NotFound",
                  description: "Missing test payload file.",
                  pathOrDescriptor: path,
                  module: "FileSystem",
                  method: "readFileString",
                }),
              )
            : Effect.succeed(payloadFiles[path]),
        writeFileString: (path, content) =>
          Effect.sync(() => {
            payloadFiles[path] = content;
          }),
        remove: (path) =>
          Effect.sync(() => {
            delete payloadFiles[path];
          }),
      }),
    ),
    Layer.provideMerge(NodeHttpClient.layerUndici),
    Layer.provideMerge(
      DesktopEnvironment.layer({
        dirname: "/repo/apps/desktop/src",
        homeDirectory: "/Users/alice",
        platform: "darwin",
        processArch: "arm64",
        appVersion: "1.2.3",
        appPath: "/repo",
        isPackaged: true,
        resourcesPath: "/missing/resources",
        runningUnderArm64Translation: false,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
        ),
      ),
    ),
    Layer.provideMerge(DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    Layer.provideMerge(NodeServices.layer),
  );

describe("DesktopPayloadUpdates", () => {
  it.effect("initializes currentPayloadVersion from the launch-selected pending payload", () => {
    const payloadFiles: Record<string, string> = {
      [pendingPointerPath]: JSON.stringify({
        version: "1.2.4",
        minShellVersion: "1.2.3",
        sha256: "abc",
        stagedAt: "2026-07-02T00:00:00.000Z",
      }),
      [activePointerPath]: "",
    };

    return Effect.gen(function* () {
      const payloadUpdates = yield* DesktopPayloadUpdates.DesktopPayloadUpdates;
      const state = yield* payloadUpdates.getState;

      assert.equal(state.currentPayloadVersion, "1.2.4");
      assert.property(payloadFiles, activePayloadPointerPath);
      assert.notProperty(payloadFiles, pendingPointerPath);
    }).pipe(Effect.provide(makePayloadLayer(payloadFiles)));
  });
});
