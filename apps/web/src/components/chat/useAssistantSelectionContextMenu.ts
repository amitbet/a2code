import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent } from "react";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import { readLocalApi } from "~/localApi";

/**
 * Fork: citing assistant text lives in the right-click menu instead of a
 * floating button over every selection. Right-clicking selected assistant text
 * offers Cite and Copy; any other right-click keeps its usual menu. Copy is
 * offered because claiming the event also suppresses the desktop's native menu.
 */
export function useAssistantSelectionContextMenu(input: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef | null | undefined;
  onCite:
    | ((citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean)
    | undefined;
}) {
  const { viewport, threadRef, onCite } = input;
  // The handler changes identity on most renders; the listener reads the latest.
  const cite = useEffectEvent(
    (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) =>
      onCite?.(citation, sourceAnchor) ?? false,
  );
  const canCite = onCite !== undefined;

  useEffect(() => {
    if (!viewport || !threadRef) return;
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || !canCite) return;
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      const api = readLocalApi();
      if (!captured || !messageId || !api) return;
      event.preventDefault();

      const citation: AssistantCitation = {
        version: 1,
        ...threadRef,
        messageId: MessageId.make(messageId),
        ...captured.selector,
      };
      const sourceAnchor: AssistantCitationSourceAnchor = {
        source: captured.source,
        range: captured.range,
        viewport,
      };
      const tooLong = citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
      // A keyboard-opened menu reports no pointer; anchor it to the selection's end.
      const lastLine = captured.range.getClientRects();
      const anchor = lastLine.item(lastLine.length - 1) ?? captured.range.getBoundingClientRect();
      const position =
        event.clientX === 0 && event.clientY === 0
          ? { x: anchor.right, y: anchor.bottom + 4 }
          : { x: event.clientX, y: event.clientY };

      void api.contextMenu
        .show(
          [
            {
              id: "cite",
              label: tooLong ? "Selection is too long to cite" : "Cite in composer",
              disabled: tooLong,
            },
            { id: "copy", label: "Copy" },
          ] as const,
          position,
        )
        .then((clicked) => {
          if (clicked === "cite") {
            if (cite(citation, sourceAnchor)) {
              window.getSelection()?.removeAllRanges();
            }
            return;
          }
          if (clicked === "copy") {
            // Keeps the rich copy the native menu's Copy role makes.
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(captured.range);
            document.execCommand("copy");
          }
        });
    };
    viewport.addEventListener("contextmenu", onContextMenu);
    return () => viewport.removeEventListener("contextmenu", onContextMenu);
  }, [canCite, threadRef, viewport]);
}
