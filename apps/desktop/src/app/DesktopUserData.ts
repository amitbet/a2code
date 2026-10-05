import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

export class DesktopUserDataInitializationError extends Schema.TaggedError<DesktopUserDataInitializationError>()(
  "DesktopUserDataInitializationError",
  {
    operation: Schema.Literals(["inspect", "read", "create-directory", "write"]),
    resourcePath: Schema.String,
    category: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Could not initialize Electron user data during ${this.operation} at ${this.resourcePath} (${this.category}).`;
  }

  static fromFileSystem(
    cause: PlatformError.PlatformError,
    operation: DesktopUserDataInitializationError["operation"],
    resourcePath: string,
  ) {
    return new DesktopUserDataInitializationError({
      operation,
      resourcePath,
      category: cause.reason._tag,
      cause,
    });
  }
}

/** Select Electron's profile independently of the server's T3 home. */
export const resolveUserDataPath = Effect.fn("desktop.userData.resolveUserDataPath")(
  function* (input: { readonly appDataDirectory: string; readonly isDevelopment: boolean }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // Fork: A2 Code keeps its existing profile instead of upstream's `t3code-v2`
    // split. Upstream moved to a fresh profile so its v1 and v2 apps can run side
    // by side, and copies the Windows `Local State` (safeStorage keys) across.
    // Here the profile never moves, so an existing legacy profile wins and there
    // is nothing to migrate; a fresh switch would drop localStorage and
    // remote-environment cookies.
    const names = input.isDevelopment
      ? { current: "a2code-dev", legacy: "A2 Code (Dev)" }
      : { current: "a2code", legacy: "A2 Code" };
    const legacyPath = path.join(input.appDataDirectory, names.legacy);
    const legacyExists = yield* fs
      .exists(legacyPath)
      .pipe(
        Effect.mapError((cause) =>
          DesktopUserDataInitializationError.fromFileSystem(cause, "inspect", legacyPath),
        ),
      );
    return legacyExists ? legacyPath : path.join(input.appDataDirectory, names.current);
  },
);
