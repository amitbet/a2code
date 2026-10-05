import { COMPOSER_CONTEXT_CLIPBOARD_MIME, type ScopedThreadRef } from "@t3tools/contracts";
import { encodeComposerContextFragment } from "@t3tools/shared/composerContextClipboard";

import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { formatInlineContextReference } from "./composerContextReferences";
import { threadContextRecord, threadContextReference } from "./composerContextRecords";

/**
 * Fork: "Copy thread ref" copies a thread as a composer context reference. Pasting it
 * into a composer on the same machine adds a thread chip the agent reads through
 * `t3_thread_read`; on another machine the composer attaches the thread's transcript.
 */
export function copyThreadReferenceToClipboard(ref: ScopedThreadRef, title: string) {
  const record = threadContextRecord(ref, title);
  const fragment = encodeComposerContextFragment({
    version: 1,
    source: { environmentId: ref.environmentId },
    records: [record],
  });
  return writeTextToClipboard(
    formatInlineContextReference(threadContextReference(record)),
    "thread reference",
    fragment === null ? undefined : { [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment },
  );
}
