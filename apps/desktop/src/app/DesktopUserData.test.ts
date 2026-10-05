import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect("identifies a failed legacy profile probe and preserves its cause", () => {
  const legacyPath = "/profiles/A2 Code";
  const cause = PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "exists",
    pathOrDescriptor: legacyPath,
  });
  return Effect.gen(function* () {
    const error = yield* resolveUserDataPath({
      appDataDirectory: "/profiles",
      isDevelopment: false,
    }).pipe(Effect.flip);
    assert.equal(error.operation, "inspect");
    assert.equal(error.resourcePath, legacyPath);
    assert.equal(error.category, "PermissionDenied");
    assert.strictEqual(error.cause, cause);
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({ exists: () => Effect.fail(cause) }),
    ),
    Effect.provide(NodeServices.layer),
  );
});

it.effect.each([
  { isDevelopment: false, legacy: "A2 Code", current: "a2code" },
  { isDevelopment: true, legacy: "A2 Code (Dev)", current: "a2code-dev" },
])(
  "prefers the $legacy profile when it exists, else $current",
  ({ isDevelopment, legacy, current }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "a2-profile-" });
      // An upstream T3 Code profile on the same machine is never adopted.
      yield* fs.makeDirectory(path.join(directory, "t3code"), { recursive: true });
      yield* fs.writeFileString(path.join(directory, "t3code", "Local State"), "t3 keys");

      assert.equal(
        yield* resolveUserDataPath({ appDataDirectory: directory, isDevelopment }),
        path.join(directory, current),
      );
      assert.isFalse(yield* fs.exists(path.join(directory, current)));

      yield* fs.makeDirectory(path.join(directory, legacy));
      assert.equal(
        yield* resolveUserDataPath({ appDataDirectory: directory, isDevelopment }),
        path.join(directory, legacy),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
