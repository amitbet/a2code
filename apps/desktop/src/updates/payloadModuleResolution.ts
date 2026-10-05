/**
 * Node `--import` module that lets a hot-update payload backend load the
 * server bundle's external packages from the installed shell.
 *
 * A payload runs from `<stateDir>/payloads/<version>/bin.mjs` and carries only
 * `apps/server/dist`. Everything the bundle leaves external (native addons such
 * as node-pty and the keyring, plus the Cursor SDK and its JS closure; see
 * scripts/lib/cli-external-packages.ts) lives in the shell's `node_modules`,
 * which Node never searches from the payload directory. A static import of one
 * of them fails the whole backend at link time; a lazy `createRequire` fails
 * the feature that needs it (terminals, Cursor).
 *
 * The hook only steps in after Node's own resolution fails, only for bare
 * specifiers, and only for modules inside the payloads directory. It retries
 * from the shell-bundled backend entry, so a payload resolves exactly what the
 * bundled backend would. `registerHooks` covers both `import` and `require`;
 * the CommonJS default resolver ignores a substituted `parentURL`, hence the
 * explicit `createRequire` for that path.
 */
const HOOK_SOURCE = `
import * as Fs from "node:fs";
import * as Module from "node:module";
import * as Url from "node:url";

const { bundledEntryPath, payloadsDir } = JSON.parse(__INPUT__);
const fallbackParentURL = Url.pathToFileURL(bundledEntryPath).href;
const directoryURL = (path) => Url.pathToFileURL(path).href.replace(/\\/?$/, "/");
// Module URLs are real paths, so also match a payloads dir reached through a symlink.
const payloadsURLs = [payloadsDir, ...(() => {
  try {
    return [Fs.realpathSync(payloadsDir)];
  } catch {
    return [];
  }
})()].map(directoryURL);
const isPayloadModule = (url) => payloadsURLs.some((prefix) => url?.startsWith(prefix));
const requireFromShell = Module.createRequire(fallbackParentURL);
const isBareSpecifier = (specifier) =>
  !/^(?:\\.{0,2}\\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(specifier);

Module.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!isBareSpecifier(specifier) || !isPayloadModule(context.parentURL)) throw error;
      try {
        return context.conditions?.includes("require")
          ? { url: Url.pathToFileURL(requireFromShell.resolve(specifier)).href, shortCircuit: true }
          : nextResolve(specifier, { ...context, parentURL: fallbackParentURL });
      } catch {
        throw error;
      }
    }
  },
});
`;

/** The `--import` argument value for a backend launched from a payload. */
export function makePayloadModuleResolutionImport(input: {
  readonly bundledEntryPath: string;
  readonly payloadsDir: string;
}): string {
  const source = HOOK_SOURCE.replace(
    "__INPUT__",
    JSON.stringify(
      JSON.stringify({ bundledEntryPath: input.bundledEntryPath, payloadsDir: input.payloadsDir }),
    ),
  );
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
