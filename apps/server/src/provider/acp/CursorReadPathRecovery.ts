import { toolActivityPrimaryPath } from "@t3tools/shared/toolActivity";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { collectUint8StreamText } from "../../stream/collectUint8StreamText.ts";
import type { AcpToolCallState } from "./AcpRuntimeModel.ts";

const READ_PATH_PROBE_TIMEOUT = Duration.millis(750);
const READ_PATH_PROBE_MAX_LENGTH = 240;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function cursorReadContent(toolCall: AcpToolCallState): string | undefined {
  if (toolCall.kind !== "read" || toolActivityPrimaryPath(toolCall.data)) {
    return undefined;
  }
  const content = asRecord(toolCall.data.rawOutput)?.content;
  return typeof content === "string" && content.trim().length > 0 ? content : undefined;
}

/**
 * Pick a distinctive, argv-safe fragment of the returned file contents. Cursor's
 * ACP read events currently omit the input path entirely, so this fragment is
 * used for a bounded workspace lookup when the read completes.
 */
export function cursorReadPathProbe(content: string): string | undefined {
  const candidates = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && !/^\s*[{}()[\],;]+\s*$/u.test(line))
    .sort((left, right) => right.length - left.length);
  const candidate = candidates[0] ?? content.trim();
  if (candidate.length < 12) {
    return undefined;
  }
  return candidate.slice(0, READ_PATH_PROBE_MAX_LENGTH);
}

export const recoverCursorReadPath = Effect.fn("CursorReadPathRecovery.recover")(function* (input: {
  readonly toolCall: AcpToolCallState;
  readonly cwd: string | undefined;
  readonly path: Path.Path;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}) {
  const content = cursorReadContent(input.toolCall);
  const probe = content ? cursorReadPathProbe(content) : undefined;
  if (!probe || !input.cwd) {
    return input.toolCall;
  }

  const cwd = input.cwd;
  const lookup = Effect.gen(function* () {
    const child = yield* input.childProcessSpawner.spawn(
      ChildProcess.make(
        "rg",
        [
          "--files-with-matches",
          "--fixed-strings",
          "--max-filesize",
          "4M",
          "--glob",
          "!.git/**",
          "--",
          probe,
          ".",
        ],
        { cwd },
      ),
    );
    const [stdout, _stderr, exitCode] = yield* Effect.all(
      [
        collectUint8StreamText({ stream: child.stdout, maxBytes: 16 * 1024 }),
        collectUint8StreamText({ stream: child.stderr, maxBytes: 4 * 1024 }),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0 || stdout.truncated) {
      return undefined;
    }
    const matches = stdout.text
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return matches.length === 1 ? input.path.resolve(cwd, matches[0]!) : undefined;
  }).pipe(Effect.scoped, Effect.timeoutOption(READ_PATH_PROBE_TIMEOUT), Effect.option);

  const result = yield* lookup;
  const recoveredPath = Option.isSome(result) ? Option.getOrUndefined(result.value) : undefined;
  if (!recoveredPath) {
    return input.toolCall;
  }
  return {
    ...input.toolCall,
    detail: recoveredPath,
    data: {
      ...input.toolCall.data,
      locations: [{ path: recoveredPath }],
    },
  } satisfies AcpToolCallState;
});
