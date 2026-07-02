import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { DesktopPayloadManifest } from "@t3tools/contracts";
import { createPayloadArchive } from "@t3tools/shared/payloadArchive";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopPayloadUpdates from "./DesktopPayloadUpdates.ts";
import { computeSha256Hex } from "./payloadSigning.ts";

const baseDir = "/tmp/t3-desktop-payload-updates-test";
const pendingPointerPath = `${baseDir}/userdata/payloads/pending.json`;
const activePointerPath = `${baseDir}/userdata/payloads/1.2.4/bin.mjs`;
const activePayloadPointerPath = `${baseDir}/userdata/payloads/active.json`;

const makePayloadLayer = (
  payloadFiles: Record<string, string>,
  options: {
    readonly config?: Readonly<Record<string, string | undefined>>;
    readonly httpClientLayer?: Layer.Layer<HttpClient.HttpClient>;
  } = {},
) =>
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
        writeFile: () => Effect.void,
        makeDirectory: () => Effect.void,
        remove: (path) =>
          Effect.sync(() => {
            delete payloadFiles[path];
          }),
        rename: () => Effect.void,
      }),
    ),
    Layer.provideMerge(options.httpClientLayer ?? NodeHttpClient.layerUndici),
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
          Layer.mergeAll(
            NodeServices.layer,
            DesktopConfig.layerTest({
              T3CODE_HOME: baseDir,
              ...options.config,
            }),
          ),
        ),
      ),
    ),
    Layer.provideMerge(DesktopConfig.layerTest({ T3CODE_HOME: baseDir, ...options.config })),
    Layer.provideMerge(NodeServices.layer),
  );

const chunk = (bytes: Uint8Array, start: number, end: number): Uint8Array =>
  bytes.slice(start, end);

function makeChunkedResponse(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const firstEnd = Math.max(1, Math.floor(bytes.byteLength / 3));
  const secondEnd = Math.max(firstEnd + 1, Math.floor((bytes.byteLength * 2) / 3));
  const chunks = [
    chunk(bytes, 0, firstEnd),
    chunk(bytes, firstEnd, secondEnd),
    chunk(bytes, secondEnd, bytes.byteLength),
  ].filter((entry) => entry.byteLength > 0);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const entry of chunks) {
        controller.enqueue(entry);
      }
      controller.close();
    },
  });
}

const makePayloadHttpClientLayer = (input: {
  readonly manifestUrl: string;
  readonly archiveBytes: Uint8Array;
  readonly manifest: DesktopPayloadManifest;
}) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const body =
        request.url === input.manifestUrl
          ? JSON.stringify(input.manifest)
          : request.url === new URL(input.manifest.fileName, input.manifestUrl).toString()
            ? makeChunkedResponse(input.archiveBytes)
            : "not found";
      const status =
        request.url === input.manifestUrl ||
        request.url === new URL(input.manifest.fileName, input.manifestUrl).toString()
          ? 200
          : 404;
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status })));
    }),
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

  it.effect("emits archive download progress while staging a payload", () => {
    const payloadFiles: Record<string, string> = {};
    const archiveBytes = createPayloadArchive([
      { path: "bin.mjs", data: new TextEncoder().encode("console.log('server')\n") },
      { path: "client/index.html", data: new TextEncoder().encode("<!doctype html>") },
    ]);
    const manifestUrl = "https://updates.test/payload-manifest.json";
    const manifest: DesktopPayloadManifest = {
      schemaVersion: 1,
      version: "1.2.4",
      minShellVersion: "1.2.3",
      fileName: "payload.tar.gz",
      sizeBytes: archiveBytes.byteLength,
      sha256: computeSha256Hex(archiveBytes),
      signature: "",
      createdAt: "2026-07-02T00:00:00.000Z",
    };

    return Effect.gen(function* () {
      const payloadUpdates = yield* DesktopPayloadUpdates.DesktopPayloadUpdates;
      const observed: Array<number | null> = [];
      const fiber = yield* payloadUpdates.changes.pipe(
        Stream.runForEach((state) =>
          Effect.sync(() => {
            observed.push(state.downloadPercent);
          }),
        ),
        Effect.forkChild,
      );

      yield* Effect.yieldNow;
      const state = yield* payloadUpdates.download;
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);

      assert.equal(state.status, "staged");
      assert.equal(state.downloadPercent, 100);
      assert.isTrue(
        observed.some((percent) => typeof percent === "number" && percent > 0 && percent < 100),
      );
    }).pipe(
      Effect.provide(
        makePayloadLayer(payloadFiles, {
          config: {
            T3CODE_PAYLOAD_ALLOW_UNSIGNED: "true",
            T3CODE_PAYLOAD_MANIFEST_URL: manifestUrl,
          },
          httpClientLayer: makePayloadHttpClientLayer({ manifestUrl, archiveBytes, manifest }),
        }),
      ),
    );
  });
});
