/**
 * Build a downloadable zip archive of a thread: its conversation transcript as
 * `transcript.md` plus every attachment under `attachments/`.
 *
 * The transcript reuses the shared {@link buildThreadTranscript} serializer, so
 * an export carries the same completed-work view (messages + tool calls and
 * results) as fork/reference. This builder is pure — the caller resolves
 * attachment bytes (from the attachment store) and passes them in — which keeps
 * it free of filesystem concerns and unit testable.
 *
 * @module threadExport
 */
import type { OrchestrationThread } from "@t3tools/contracts";
import { buildThreadTranscript } from "@t3tools/shared/threadTranscript";
import { zipSync } from "fflate";

export const THREAD_EXPORT_TRANSCRIPT_ENTRY = "transcript.md";
const ATTACHMENTS_DIR_ENTRY = "attachments";

/** Strip path separators / leading dots so an attachment name is a safe zip entry. */
function sanitizeEntryName(name: string): string {
  const base = name
    .replace(/[\\/]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return base.length > 0 ? base : "attachment";
}

export interface BuildThreadExportZipInput {
  readonly thread: OrchestrationThread;
  /** Attachment bytes keyed by attachment id; missing entries are skipped. */
  readonly attachmentBytesById: ReadonlyMap<string, Uint8Array>;
}

/**
 * Build the zip archive bytes for a thread export. Attachments without resolved
 * bytes are skipped (the transcript still lists them). Name collisions are
 * disambiguated with the attachment id.
 */
export function buildThreadExportZip(input: BuildThreadExportZipInput): Uint8Array {
  const { thread, attachmentBytesById } = input;
  const transcript = buildThreadTranscript(
    {
      messages: thread.messages,
      activities: thread.activities,
      latestTurn: thread.latestTurn,
    },
    {
      heading: `# ${thread.title}`,
      sourceTitle: thread.title,
      // Exports should preserve the complete completed tool result, just like
      // the transcript artifact used by thread refs and replayed forks.
      maxToolResultChars: Number.MAX_SAFE_INTEGER,
    },
  );
  const files: Record<string, Uint8Array> = {
    [THREAD_EXPORT_TRANSCRIPT_ENTRY]: new TextEncoder().encode(transcript),
  };

  const seenAttachmentIds = new Set<string>();
  const usedEntryNames = new Set<string>([THREAD_EXPORT_TRANSCRIPT_ENTRY]);
  for (const message of thread.messages) {
    for (const attachment of message.attachments ?? []) {
      if (seenAttachmentIds.has(attachment.id)) {
        continue;
      }
      seenAttachmentIds.add(attachment.id);
      const bytes = attachmentBytesById.get(attachment.id);
      if (bytes === undefined) {
        continue;
      }
      const safeName = sanitizeEntryName(attachment.name);
      let entryName = `${ATTACHMENTS_DIR_ENTRY}/${safeName}`;
      if (usedEntryNames.has(entryName)) {
        entryName = `${ATTACHMENTS_DIR_ENTRY}/${attachment.id}-${safeName}`;
      }
      usedEntryNames.add(entryName);
      files[entryName] = bytes;
    }
  }

  return zipSync(files);
}
