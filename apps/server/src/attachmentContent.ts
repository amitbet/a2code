// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

/**
 * How an uploaded attachment should be rendered into model input. Adapters share
 * this classification so non-image files (JSON, text, PDFs, ...) are no longer
 * silently dropped or mislabeled as images.
 */
export type AttachmentRenderKind = "image" | "pdf" | "text" | "binary";

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/javascript",
  "application/x-javascript",
  "application/x-sh",
  "application/x-ndjson",
  "application/sql",
  "application/csv",
  "image/svg+xml",
]);

const TEXT_EXTENSIONS = new Set([
  ".csv",
  ".htm",
  ".html",
  ".json",
  ".log",
  ".md",
  ".svg",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const FENCE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".csv": "csv",
  ".htm": "html",
  ".html": "html",
  ".json": "json",
  ".md": "markdown",
  ".svg": "xml",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function classifyAttachment(input: {
  readonly mimeType: string;
  readonly fileName?: string;
}): AttachmentRenderKind {
  const mime = input.mimeType.trim().toLowerCase();
  if (mime === "application/pdf") {
    return "pdf";
  }
  if (mime.startsWith("image/") && mime !== "image/svg+xml") {
    return "image";
  }
  if (mime.startsWith("text/") || TEXT_MIME_TYPES.has(mime)) {
    return "text";
  }
  const extension = NodePath.extname(input.fileName?.trim() ?? "").toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return "binary";
}

/** Markdown fence language hint for an inlined text attachment, or "" when unknown. */
export function fenceLanguageForAttachment(input: {
  readonly mimeType: string;
  readonly fileName?: string;
}): string {
  const extension = NodePath.extname(input.fileName?.trim() ?? "").toLowerCase();
  if (extension && Object.hasOwn(FENCE_LANGUAGE_BY_EXTENSION, extension)) {
    return FENCE_LANGUAGE_BY_EXTENSION[extension] ?? "";
  }
  const mime = input.mimeType.trim().toLowerCase();
  if (mime === "application/json" || mime === "application/ld+json") return "json";
  if (mime === "application/xml" || mime === "image/svg+xml") return "xml";
  if (mime === "application/yaml" || mime === "application/x-yaml") return "yaml";
  return "";
}

/**
 * Largest text attachment we inline verbatim into a prompt. Bigger files would
 * blow the model's context window, so we inline only a head preview and point
 * the agent at the on-disk path to read the rest on demand (matching how Codex
 * and Claude Code reference large files instead of dumping them whole).
 */
export const ATTACHMENT_INLINE_MAX_BYTES = 256 * 1024;

/**
 * Render a text-file attachment as a single block of prompt text, prefixed with
 * the file name and mime type. Files up to {@link ATTACHMENT_INLINE_MAX_BYTES}
 * are inlined whole; larger files are truncated to a head preview with a note
 * giving the total size and the absolute path so the agent can read the full
 * contents itself rather than overflowing the context window.
 */
export function formatTextAttachmentBlock(input: {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly absolutePath: string;
}): string {
  const language = fenceLanguageForAttachment({ mimeType: input.mimeType, fileName: input.name });
  const fence = "```";
  const buffer = Buffer.from(input.bytes);
  const truncated = buffer.length > ATTACHMENT_INLINE_MAX_BYTES;
  const contents = (truncated ? buffer.subarray(0, ATTACHMENT_INLINE_MAX_BYTES) : buffer).toString(
    "utf8",
  );

  const header = truncated
    ? `Attached file: ${input.name} (${input.mimeType}, ${buffer.length} bytes — showing the first ${ATTACHMENT_INLINE_MAX_BYTES} bytes; read ${input.absolutePath} for the full contents)`
    : `Attached file: ${input.name} (${input.mimeType})`;

  return [header, "", `${fence}${language}`, contents, fence].join("\n");
}
