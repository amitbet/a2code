#!/usr/bin/env node

import * as NodeCrypto from "node:crypto";

import { DesktopPayloadManifestSchema } from "@t3tools/contracts";
import { createPayloadArchive, type PayloadArchiveEntry } from "@t3tools/shared/payloadArchive";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

/**
 * Builds the JS-only payload release asset consumed by the desktop payload
 * hot-update channel (see apps/desktop/src/updates/DesktopPayloadUpdates.ts):
 *
 *   release/payload-<version>.tar.gz   — gzip+tar of apps/server/dist
 *                                        (bundled server bin + chunks + web client)
 *   release/payload-manifest.json      — DesktopPayloadManifest (sha256 + Ed25519 signature)
 *
 * The archive is created with the project's own tar codec so the running app
 * can extract it without a third-party/native archive dependency. The manifest
 * is signed with the Ed25519 private key from `T3CODE_PAYLOAD_SIGNING_KEY`; the
 * app verifies it against the embedded public key before applying a payload.
 */

const PAYLOAD_ARCHIVE_PREFIX = "payload-";
const PAYLOAD_MANIFEST_FILENAME = "payload-manifest.json";
// The oldest shell whose native ABI can run this payload. Bump (via
// T3CODE_PAYLOAD_MIN_SHELL_VERSION) only when native deps / Electron change, so
// older shells stop receiving JS payloads that need a newer native shell.
const DEFAULT_MIN_SHELL_VERSION = "0.0.0";

const encodeManifest = Schema.encodeUnknownEffect(
  Schema.fromJsonString(DesktopPayloadManifestSchema),
);

const toPosixPath = (value: string): string => value.replaceAll("\\", "/");

const collectServerDistEntries = Effect.fn("buildPayload.collectEntries")(function* (
  serverDistDir: string,
): Effect.fn.Return<
  ReadonlyArray<PayloadArchiveEntry>,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const relativePaths = yield* fileSystem.readDirectory(serverDistDir, { recursive: true });
  const entries: PayloadArchiveEntry[] = [];
  for (const relativePath of relativePaths.sort()) {
    const absolutePath = path.join(serverDistDir, relativePath);
    const info = yield* fileSystem.stat(absolutePath);
    if (info.type !== "File") {
      continue;
    }
    const data = yield* fileSystem.readFile(absolutePath);
    entries.push({ path: toPosixPath(relativePath), data });
  }
  return entries;
});

const normalizePrivateKeyPem = (raw: string): string =>
  raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");

const signSha256Hex = (sha256Hex: string, privateKeyPem: string): string => {
  const privateKey = NodeCrypto.createPrivateKey(privateKeyPem);
  return NodeCrypto.sign(null, Buffer.from(sha256Hex, "ascii"), privateKey).toString("base64");
};

interface BuildPayloadOptions {
  readonly version: string;
  readonly outputDir: string;
  readonly minShellVersion: string;
  readonly signingKey: Option.Option<string>;
}

const buildPayloadAsset = Effect.fn("buildPayload.run")(function* (options: BuildPayloadOptions) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const serverDistDir = path.join(repoRoot, "apps/server/dist");

  if (!(yield* fileSystem.exists(path.join(serverDistDir, "bin.mjs")))) {
    return yield* Effect.die(
      new Error(
        `Missing ${serverDistDir}/bin.mjs. Run \`vp run build:desktop\` (or build the server) first.`,
      ),
    );
  }
  if (!(yield* fileSystem.exists(path.join(serverDistDir, "client/index.html")))) {
    return yield* Effect.die(
      new Error(`Missing bundled web client in ${serverDistDir}/client. Rebuild server artifacts.`),
    );
  }

  yield* Effect.log("[payload-asset] Collecting apps/server/dist...");
  const entries = yield* collectServerDistEntries(serverDistDir);
  const archive = createPayloadArchive(entries);
  const sha256 = NodeCrypto.createHash("sha256").update(archive).digest("hex");

  const signature = Option.match(options.signingKey, {
    onNone: () => "",
    onSome: (key) => signSha256Hex(sha256, normalizePrivateKeyPem(key)),
  });
  if (signature.length === 0) {
    yield* Effect.logWarning(
      "[payload-asset] No T3CODE_PAYLOAD_SIGNING_KEY set; emitting UNSIGNED manifest. The app will refuse this payload unless T3CODE_PAYLOAD_ALLOW_UNSIGNED is set.",
    );
  }

  const fileName = `${PAYLOAD_ARCHIVE_PREFIX}${options.version}.tar.gz`;
  const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const manifest = {
    schemaVersion: 1 as const,
    version: options.version,
    minShellVersion: options.minShellVersion,
    fileName,
    sizeBytes: archive.byteLength,
    sha256,
    signature,
    createdAt,
  };

  yield* fileSystem.makeDirectory(options.outputDir, { recursive: true });
  const archivePath = path.join(options.outputDir, fileName);
  const manifestPath = path.join(options.outputDir, PAYLOAD_MANIFEST_FILENAME);
  yield* fileSystem.writeFile(archivePath, archive);
  const manifestJson = yield* encodeManifest(manifest).pipe(Effect.orDie);
  yield* fileSystem.writeFileString(manifestPath, manifestJson);

  yield* Effect.log("[payload-asset] Wrote payload asset and manifest.").pipe(
    Effect.annotateLogs({
      archivePath,
      manifestPath,
      version: options.version,
      sizeBytes: archive.byteLength,
      fileCount: entries.length,
      signed: signature.length > 0,
    }),
  );
});

const resolveOptions = Effect.fn("buildPayload.resolveOptions")(function* (input: {
  readonly version: Option.Option<string>;
  readonly outputDir: Option.Option<string>;
}) {
  const path = yield* Path.Path;
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const env = yield* Config.all({
    version: Config.string("T3CODE_PAYLOAD_VERSION").pipe(Config.option),
    minShellVersion: Config.string("T3CODE_PAYLOAD_MIN_SHELL_VERSION").pipe(Config.option),
    signingKey: Config.string("T3CODE_PAYLOAD_SIGNING_KEY").pipe(Config.option),
  });
  const version = Option.getOrUndefined(input.version) ?? Option.getOrUndefined(env.version);
  if (!version || version.trim().length === 0) {
    return yield* Effect.die(
      new Error("Payload version is required (--version or T3CODE_PAYLOAD_VERSION)."),
    );
  }
  return {
    version: version.trim().replace(/^v/, ""),
    outputDir: Option.getOrElse(input.outputDir, () => path.join(repoRoot, "release")),
    minShellVersion: Option.getOrElse(env.minShellVersion, () => DEFAULT_MIN_SHELL_VERSION).trim(),
    signingKey: env.signingKey.pipe(
      Option.map((key) => key.trim()),
      Option.filter((key) => key.length > 0),
    ),
  } satisfies BuildPayloadOptions;
});

const buildPayloadAssetCli = Command.make("build-payload-asset", {
  version: Flag.string("version").pipe(
    Flag.withDescription("Payload version, e.g. 1.2.3 (env: T3CODE_PAYLOAD_VERSION)."),
    Flag.optional,
  ),
  outputDir: Flag.string("output-dir").pipe(
    Flag.withDescription("Output directory for the asset + manifest (default: release/)."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Build the desktop JS payload release asset + signed manifest."),
  Command.withHandler((input) => Effect.flatMap(resolveOptions(input), buildPayloadAsset)),
);

const cliRuntimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

if (import.meta.main) {
  Command.run(buildPayloadAssetCli, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide(cliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
