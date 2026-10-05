/**
 * Build a downloadable zip of a thread: its Markdown transcript as
 * `transcript.md` plus every attachment under `attachments/`.
 *
 * Pure: the caller reads attachment bytes from the attachment store and passes
 * them in, which keeps filesystem concerns out and the builder unit testable.
 *
 * @module threadExport
 */
import {
  buildThreadTranscript,
  collectThreadTranscriptAttachments,
  type ThreadTranscriptSource,
} from "@t3tools/shared/threadTranscript";
import { zipSync } from "fflate";

export const THREAD_EXPORT_TRANSCRIPT_ENTRY = "transcript.md";
const ATTACHMENTS_DIR_ENTRY = "attachments";

/** Strip path separators and leading dots so an attachment name is a safe zip entry. */
function sanitizeEntryName(name: string): string {
  const base = name
    .replace(/[\\/]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return base.length > 0 ? base : "attachment";
}

export interface BuildThreadExportZipInput {
  readonly title: string;
  readonly source: ThreadTranscriptSource;
  /** Attachment bytes keyed by attachment id; attachments without bytes are left out. */
  readonly attachmentBytesById: ReadonlyMap<string, Uint8Array>;
}

/**
 * Build the zip bytes. The transcript lists every attachment and points at its
 * zip path when the bytes were included. Name collisions get the attachment id
 * as a prefix.
 */
export function buildThreadExportZip(input: BuildThreadExportZipInput): Uint8Array {
  const { title, source, attachmentBytesById } = input;
  const files: Record<string, Uint8Array> = {};
  const attachmentPathsById = new Map<string, string>();
  const usedEntryNames = new Set<string>([THREAD_EXPORT_TRANSCRIPT_ENTRY]);

  for (const attachment of collectThreadTranscriptAttachments(source)) {
    const bytes = attachmentBytesById.get(attachment.id);
    if (bytes === undefined) continue;
    const safeName = sanitizeEntryName(attachment.name);
    let entryName = `${ATTACHMENTS_DIR_ENTRY}/${safeName}`;
    if (usedEntryNames.has(entryName)) {
      entryName = `${ATTACHMENTS_DIR_ENTRY}/${sanitizeEntryName(attachment.id)}-${safeName}`;
    }
    usedEntryNames.add(entryName);
    attachmentPathsById.set(attachment.id, entryName);
    files[entryName] = bytes;
  }

  const transcript = buildThreadTranscript(source, {
    heading: `# ${title}`,
    attachmentPathsById,
  });
  files[THREAD_EXPORT_TRANSCRIPT_ENTRY] = new TextEncoder().encode(transcript);

  return zipSync(files);
}
