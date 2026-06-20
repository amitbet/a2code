/**
 * Pure, provider-agnostic serialization of a thread's history into a Markdown
 * transcript.
 *
 * This is a shared primitive with several intended consumers:
 * - cross-provider thread forking (the source thread's context is replayed into
 *   the fork's first message as an attached transcript artifact),
 * - referencing one thread's context from within another conversation,
 * - exporting a conversation for use outside the app (download / zip / handoff
 *   to an external agent).
 *
 * It serializes *completed work*: user/assistant messages interleaved with
 * completed tool steps (the call and its result) and errors, in chronological
 * order. It deliberately omits:
 * - proposed plans (intent / in-flight work, not completed work),
 * - the currently-running turn (an in-flight prompt and its partial work),
 * - tool `started`/`updated` lifecycle noise (only `completed` carries a result).
 *
 * It performs no I/O and depends only on contract shapes, so it runs on both the
 * server and the web client.
 *
 * @module threadTranscript
 */
import type {
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationThreadActivity,
} from "@t3tools/contracts";

import { deriveToolActivityPresentation, deriveToolActivityResult } from "./toolActivity.ts";

export interface ThreadTranscriptInput {
  /** Messages in chronological order. */
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  /** Work-log activities (tool calls/results, errors). */
  readonly activities?: ReadonlyArray<OrchestrationThreadActivity>;
  /** Latest turn state; a running turn is excluded as in-flight work. */
  readonly latestTurn?: OrchestrationLatestTurn | null;
}

export interface BuildThreadTranscriptOptions {
  /** Title of the source thread, surfaced under the document heading. */
  readonly sourceTitle?: string;
  /** Top-level heading line (including the leading `#`). */
  readonly heading?: string;
  /** Optional intro paragraph rendered under the heading. */
  readonly intro?: string;
  /** Optional source attachment access details keyed by attachment id. */
  readonly attachmentDetailsById?: ReadonlyMap<string, ThreadTranscriptAttachmentDetails>;
  /** Max characters of a single tool result to inline (default 4000). */
  readonly maxToolResultChars?: number;
}

export interface ThreadTranscriptAttachmentDetails {
  /** Absolute path to the original attachment on disk, when available. */
  readonly absolutePath?: string;
}

const DEFAULT_HEADING = "# Conversation transcript";
const DEFAULT_MAX_TOOL_RESULT_CHARS = 4000;

function roleLabel(role: OrchestrationMessage["role"]): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return String(role);
  }
}

function asActivityPayload(payload: unknown): {
  readonly itemType?: unknown;
  readonly detail?: unknown;
  readonly data?: unknown;
} {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { itemType?: unknown; detail?: unknown; data?: unknown })
    : {};
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]`;
}

type TranscriptEntry =
  | {
      readonly type: "message";
      readonly sortAt: string;
      readonly seq: number;
      readonly message: OrchestrationMessage;
    }
  | {
      readonly type: "activity";
      readonly sortAt: string;
      readonly seq: number;
      readonly activity: OrchestrationThreadActivity;
    };

function renderMessage(
  message: OrchestrationMessage,
  lines: string[],
  attachmentDetailsById?: ReadonlyMap<string, ThreadTranscriptAttachmentDetails>,
): void {
  const text = message.text.trim();
  const attachments = message.attachments ?? [];
  if (text.length === 0 && attachments.length === 0) {
    return;
  }
  lines.push("", "---", "", `## ${roleLabel(message.role)}`);
  if (text.length > 0) {
    lines.push("", text);
  }
  if (attachments.length > 0) {
    lines.push("", "Attachments:");
    for (const attachment of attachments) {
      const sizeSuffix =
        typeof attachment.sizeBytes === "number" ? `, ${attachment.sizeBytes} bytes` : "";
      const detail = attachmentDetailsById?.get(attachment.id);
      const pathSuffix = detail?.absolutePath
        ? ` — read ${detail.absolutePath} if you need the original attachment bytes`
        : "";
      lines.push(`- ${attachment.name} (${attachment.mimeType}${sizeSuffix})${pathSuffix}`);
    }
  }
}

function renderActivity(
  activity: OrchestrationThreadActivity,
  lines: string[],
  maxResultChars: number,
): void {
  if (activity.tone === "error") {
    const payload = asActivityPayload(activity.payload);
    const detail = typeof payload.detail === "string" ? payload.detail.trim() : undefined;
    lines.push("", "---", "", `### ⚠️ ${activity.summary}`);
    if (detail && detail.length > 0) {
      lines.push("", truncate(detail, maxResultChars));
    }
    return;
  }

  // Only completed tool steps carry the result payload; started/updated are noise.
  if (activity.tone !== "tool" || activity.kind !== "tool.completed") {
    return;
  }
  const payload = asActivityPayload(activity.payload);
  const presentation = deriveToolActivityPresentation({
    itemType: (payload.itemType ?? null) as never,
    title: activity.summary,
    detail: typeof payload.detail === "string" ? payload.detail : undefined,
    data: payload.data,
    fallbackSummary: activity.summary,
  });
  const result = deriveToolActivityResult({
    data: payload.data,
    detail: typeof payload.detail === "string" ? payload.detail : undefined,
  });

  const heading = presentation.detail
    ? `### 🔧 ${presentation.summary}: \`${presentation.detail}\``
    : `### 🔧 ${presentation.summary}`;
  lines.push("", "---", "", heading);
  if (result && result.length > 0) {
    lines.push("", "```", truncate(result, maxResultChars), "```");
  }
}

/**
 * Render a thread's completed history as a single Markdown document.
 *
 * Messages and completed tool activities are interleaved chronologically.
 * A running turn (and its triggering prompt) is excluded; proposed plans are
 * never included.
 */
export function buildThreadTranscript(
  input: ThreadTranscriptInput,
  options?: BuildThreadTranscriptOptions,
): string {
  const maxResultChars = options?.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;
  const excludedTurnId =
    input.latestTurn != null && input.latestTurn.state === "running"
      ? input.latestTurn.turnId
      : undefined;

  const entries: TranscriptEntry[] = [];
  for (const message of input.messages) {
    if (excludedTurnId !== undefined && message.turnId === excludedTurnId) {
      continue;
    }
    entries.push({ type: "message", sortAt: message.createdAt, seq: 0, message });
  }
  for (const activity of input.activities ?? []) {
    if (excludedTurnId !== undefined && activity.turnId === excludedTurnId) {
      continue;
    }
    entries.push({
      type: "activity",
      sortAt: activity.createdAt,
      seq: activity.sequence ?? 0,
      activity,
    });
  }

  entries.sort((left, right) => {
    if (left.sortAt !== right.sortAt) {
      return left.sortAt < right.sortAt ? -1 : 1;
    }
    // Within the same timestamp, messages precede the tool work they triggered.
    if (left.type !== right.type) {
      return left.type === "message" ? -1 : 1;
    }
    return left.seq - right.seq;
  });

  const lines: string[] = [options?.heading ?? DEFAULT_HEADING];
  if (options?.intro) {
    lines.push("", options.intro);
  }
  if (options?.sourceTitle) {
    lines.push("", `**Source thread:** ${options.sourceTitle}`);
  }

  for (const entry of entries) {
    if (entry.type === "message") {
      renderMessage(entry.message, lines, options?.attachmentDetailsById);
    } else {
      renderActivity(entry.activity, lines, maxResultChars);
    }
  }

  return `${lines.join("\n")}\n`;
}
