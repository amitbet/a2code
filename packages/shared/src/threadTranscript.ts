/**
 * Pure serialization of an orchestration v2 thread into a Markdown transcript.
 *
 * The transcript follows the thread's visible timeline (`visibleTurnItems`,
 * which already excludes rolled-back work and includes history inherited from
 * a fork source) and renders:
 * - user / assistant messages, with their attachment names and sizes,
 * - finished tool work (commands, file changes, searches, dynamic tools,
 *   subagents) with its result,
 * - proposed plans and provider errors.
 *
 * Reasoning, todo lists, lifecycle notices, and in-flight tool calls are left
 * out: the transcript records what was said and what work completed.
 *
 * Message text and attachments come from the thread's message records when
 * available (they hold the final text); the turn item is the fallback, which
 * covers messages inherited from another thread.
 *
 * No I/O; it runs on the server and the client alike.
 *
 * @module threadTranscript
 */
import type {
  ChatAttachment,
  OrchestrationV2ConversationMessage,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";

export type ThreadTranscriptSource = Pick<
  OrchestrationV2ThreadProjection,
  "messages" | "visibleTurnItems"
>;

export interface BuildThreadTranscriptOptions {
  /** Top-level heading line (including the leading `#`). */
  readonly heading?: string;
  /** Optional paragraph rendered under the heading. */
  readonly intro?: string;
  /** Max characters of a single tool input/result to inline. Unlimited by default. */
  readonly maxToolResultChars?: number;
  /** Where each attachment lives relative to the transcript, keyed by attachment id. */
  readonly attachmentPathsById?: ReadonlyMap<string, string>;
}

const DEFAULT_HEADING = "# Conversation transcript";

type MessageRole = OrchestrationV2ConversationMessage["role"];

const FINISHED_STATUSES: ReadonlySet<OrchestrationV2TurnItem["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

function roleLabel(role: MessageRole): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]`;
}

/** Fence `body` with enough backticks that its own backtick runs cannot close it. */
function fenced(body: string, language = ""): string {
  const longestRun = Math.max(0, ...Array.from(body.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${body}\n${fence}`;
}

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusSuffix(status: OrchestrationV2TurnItem["status"]): string {
  return status === "completed" ? "" : ` (${status})`;
}

class TranscriptWriter {
  readonly lines: Array<string> = [];
  private readonly options: BuildThreadTranscriptOptions;

  constructor(options: BuildThreadTranscriptOptions) {
    this.options = options;
  }

  section(title: string): void {
    this.lines.push("", "---", "", title);
  }

  paragraph(text: string): void {
    this.lines.push("", text);
  }

  block(label: string, body: string, language = ""): void {
    const max = this.options.maxToolResultChars ?? Number.POSITIVE_INFINITY;
    this.lines.push("", `${label}:`, "", fenced(truncate(body, max), language));
  }

  message(input: TranscriptMessage): void {
    const text = input.text.trim();
    if (text.length === 0 && input.attachments.length === 0) return;
    this.section(`## ${roleLabel(input.role)}`);
    if (text.length > 0) this.paragraph(text);
    if (input.attachments.length === 0) return;
    this.paragraph("Attachments:");
    for (const attachment of input.attachments) {
      const path = this.options.attachmentPathsById?.get(attachment.id);
      const location = path === undefined ? "" : ` — \`${path}\``;
      this.lines.push(
        `- ${attachment.name} (${attachment.mimeType}, ${formatBytes(attachment.sizeBytes)})${location}`,
      );
    }
  }

  toolItem(item: OrchestrationV2TurnItem): void {
    switch (item.type) {
      case "command_execution": {
        this.section(`### Command${statusSuffix(item.status)}`);
        this.block("Input", item.input, "sh");
        if (hasValue(item.output)) this.block("Output", item.output ?? "");
        if (item.exitCode !== undefined) this.paragraph(`Exit code: ${item.exitCode}`);
        return;
      }
      case "file_change": {
        const counts =
          item.additions === undefined && item.deletions === undefined
            ? ""
            : ` (+${item.additions ?? 0} -${item.deletions ?? 0})`;
        this.section(`### File change: ${item.fileName}${counts}${statusSuffix(item.status)}`);
        if (hasValue(item.diffStr)) {
          this.block("Diff", item.diffStr ?? "", "diff");
        } else if (hasValue(item.newStr)) {
          this.block("New content", item.newStr ?? "");
        }
        return;
      }
      case "file_search": {
        this.section(`### File search${statusSuffix(item.status)}`);
        if (hasValue(item.pattern)) this.paragraph(`Pattern: \`${item.pattern}\``);
        const results = item.results ?? [];
        if (results.length > 0) {
          this.block(
            "Results",
            results
              .map((result) =>
                [
                  result.fileName,
                  result.line === undefined ? "" : `:${result.line}`,
                  result.preview === undefined ? "" : `  ${result.preview}`,
                ].join(""),
              )
              .join("\n"),
          );
        }
        return;
      }
      case "web_search": {
        this.section(`### Web search${statusSuffix(item.status)}`);
        const patterns = item.patterns ?? [];
        if (patterns.length > 0) this.paragraph(`Query: ${patterns.join(", ")}`);
        for (const result of item.results ?? []) {
          const title = result.title ?? result.url ?? "Result";
          const link = result.url === undefined ? title : `[${title}](${result.url})`;
          this.lines.push(`- ${link}${result.snippet ? ` — ${result.snippet}` : ""}`);
        }
        return;
      }
      case "dynamic_tool": {
        const name = item.toolName ?? item.title ?? "Tool";
        this.section(`### Tool: ${name}${statusSuffix(item.status)}`);
        if (hasValue(item.input)) this.block("Input", jsonText(item.input), "json");
        if (hasValue(item.output)) this.block("Result", jsonText(item.output));
        return;
      }
      case "subagent": {
        this.section(`### Subagent${statusSuffix(item.status)}`);
        this.block("Prompt", item.prompt);
        if (hasValue(item.result)) this.block("Result", item.result ?? "");
        return;
      }
      default:
        return;
    }
  }
}

interface TranscriptMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}

type TranscriptEntry =
  | { readonly type: "message"; readonly message: TranscriptMessage }
  | { readonly type: "item"; readonly item: OrchestrationV2TurnItem };

/** The timeline the transcript renders, with each message resolved to its final record. */
function transcriptEntries(source: ThreadTranscriptSource): ReadonlyArray<TranscriptEntry> {
  const messagesById = new Map<string, OrchestrationV2ConversationMessage>(
    source.messages.map((message) => [message.id, message]),
  );
  const seenMessageIds = new Set<string>();
  const entries: Array<TranscriptEntry> = [];
  for (const { item } of source.visibleTurnItems) {
    if (item.type !== "user_message" && item.type !== "assistant_message") {
      entries.push({ type: "item", item });
      continue;
    }
    if (seenMessageIds.has(item.messageId)) continue;
    seenMessageIds.add(item.messageId);
    const message = messagesById.get(item.messageId);
    entries.push({
      type: "message",
      message: {
        id: item.messageId,
        role: message?.role ?? (item.type === "user_message" ? "user" : "assistant"),
        text: message?.text ?? item.text,
        attachments: message?.attachments ?? item.attachments ?? [],
      },
    });
  }
  // A timeline without message items (a projection read without turn items)
  // still exports its conversation.
  if (seenMessageIds.size === 0) {
    for (const message of source.messages) {
      entries.push({ type: "message", message });
    }
  }
  return entries;
}

/**
 * Serialize a v2 thread into Markdown. Items render in timeline order; tool
 * items render only once finished, so a running turn contributes its messages
 * but not half-done tool calls.
 */
export function buildThreadTranscript(
  source: ThreadTranscriptSource,
  options: BuildThreadTranscriptOptions = {},
): string {
  const writer = new TranscriptWriter(options);
  writer.lines.push(options.heading ?? DEFAULT_HEADING);
  if (options.intro !== undefined && options.intro.trim().length > 0) {
    writer.paragraph(options.intro.trim());
  }

  for (const entry of transcriptEntries(source)) {
    if (entry.type === "message") {
      writer.message(entry.message);
      continue;
    }
    const item = entry.item;
    switch (item.type) {
      case "proposed_plan":
        if (item.markdown.trim().length > 0) {
          writer.section("## Proposed plan");
          writer.paragraph(item.markdown.trim());
        }
        break;
      case "error":
        writer.section("### Error");
        writer.paragraph(item.failure.message);
        break;
      default:
        if (FINISHED_STATUSES.has(item.status)) writer.toolItem(item);
    }
  }

  return `${writer.lines.join("\n")}\n`;
}

/** Every distinct attachment on the messages the transcript renders, in timeline order. */
export function collectThreadTranscriptAttachments(
  source: ThreadTranscriptSource,
): ReadonlyArray<ChatAttachment> {
  const byId = new Map<string, ChatAttachment>();
  for (const entry of transcriptEntries(source)) {
    if (entry.type !== "message") continue;
    for (const attachment of entry.message.attachments) {
      if (!byId.has(attachment.id)) byId.set(attachment.id, attachment);
    }
  }
  return [...byId.values()];
}
