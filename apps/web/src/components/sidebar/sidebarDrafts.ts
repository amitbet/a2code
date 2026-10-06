import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { useCallback, useMemo, useState } from "react";

import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../../composerDraftStore";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { discardComposerDraft } from "../../lib/discardComposerDraft";
import { readLocalApi } from "../../localApi";
import { buildDraftActionMenuItems } from "../threadActionMenu.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";

// Unsent work shares one look in both sidebars: new-thread draft rows and
// thread rows with unsent composer text use this tint and pen so they read alike.
export const draftSurfaceClassName = "bg-warning/4 hover:bg-warning/8";
export const draftPenClassName = "size-3 shrink-0 text-warning-foreground";

export interface SidebarDraftRowData {
  draftId: DraftId;
  session: DraftSessionState;
  composer: ComposerThreadDraftState;
}

export function sidebarDraftProjectKey(session: DraftSessionState): string {
  return scopedProjectKey(scopeProjectRef(session.environmentId, session.projectId));
}

/** First prompt line, or an attachment count for a prompt-less draft. */
export function resolveSidebarDraftPreview(composer: ComposerThreadDraftState): string {
  const promptPreview =
    replaceComposerContextReferences(composer.prompt, (occurrence) => occurrence.label)
      .trim()
      .split("\n", 1)[0] ?? "";
  if (promptPreview.length > 0) return promptPreview;
  // images mirrors persistedAttachments once rehydration finishes; before
  // that only the persisted list is populated, hence max not sum.
  const attachmentCount =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.files.length +
    composer.terminalContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length;
  return `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`;
}

/**
 * Unsent draft sessions the user has invested content in, newest first,
 * limited to `projectKeys` (`environmentId:projectId`) unless it is null.
 *
 * Subscribes to every composer keystroke, so call it from a small leaf
 * component and render memoized rows. The open draft's row is FROZEN at the
 * moment the draft became the route: it stays visible (like a thread row) but
 * never repaints while the user types. A draft that was never navigated away
 * from has no snapshot to freeze, so a fresh typing session shows no row.
 */
export function useSidebarDraftRows(input: {
  readonly projectKeys: ReadonlySet<string> | null;
  readonly routeDraftId: string | null;
}): readonly SidebarDraftRowData[] {
  const { projectKeys, routeDraftId } = input;
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftsByThreadKey = useComposerDraftStore((store) => store.draftsByThreadKey);
  // Captured synchronously on route change (setState-during-render derived
  // state) so the row never flickers out for a frame between route change
  // and capture.
  const [frozenActive, setFrozenActive] = useState<{
    routeDraftId: string | null;
    row: SidebarDraftRowData | null;
  }>({ routeDraftId: null, row: null });
  if (frozenActive.routeDraftId !== routeDraftId) {
    let row: SidebarDraftRowData | null = null;
    if (routeDraftId !== null) {
      const draftId = DraftId.make(routeDraftId);
      const store = useComposerDraftStore.getState();
      const session = store.getDraftSession(draftId);
      const composer = store.getComposerDraft(draftId);
      row =
        session && session.promotedTo == null && composer && composerDraftHasUserContent(composer)
          ? { draftId, session, composer }
          : null;
    }
    setFrozenActive({ routeDraftId, row });
  }
  return useMemo(() => {
    const rows: SidebarDraftRowData[] = [];
    // Every non-promoted session with content gets a row, mapped or not:
    // new-thread surfaces mint fresh drafts and leave invested ones behind
    // unmapped, so the mapping only knows about the latest per project.
    for (const [draftKey, session] of Object.entries(draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (projectKeys !== null && !projectKeys.has(sidebarDraftProjectKey(session))) {
        continue;
      }
      if (draftKey === routeDraftId) {
        // Open draft: render the frozen entry snapshot, or nothing for a
        // draft that has never been left. Gated on the LIVE session above so
        // send/discard still removes the row immediately.
        if (frozenActive.routeDraftId === draftKey && frozenActive.row !== null) {
          rows.push(frozenActive.row);
        }
        continue;
      }
      const composer = draftsByThreadKey[draftKey];
      if (!composer || !composerDraftHasUserContent(composer)) {
        continue;
      }
      rows.push({ draftId: DraftId.make(draftKey), session, composer });
    }
    rows.sort((left, right) => right.session.createdAt.localeCompare(left.session.createdAt));
    return rows;
  }, [draftThreadsByThreadKey, draftsByThreadKey, frozenActive, routeDraftId, projectKeys]);
}

/** Right-click menu for an unsent draft row: copy path/branch, project settings, discard. */
export function useSidebarDraftContextMenu<TProject>(input: {
  readonly resolveProject: (session: DraftSessionState) => TProject | null;
  readonly resolveWorkspaceRoot: (session: DraftSessionState) => string | null;
  readonly openProjectSettings: (project: TProject) => void;
}): (draftId: DraftId, position: { x: number; y: number }) => void {
  const { openProjectSettings, resolveProject, resolveWorkspaceRoot } = input;
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({ type: "success", title: "Path copied", description: path });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({ type: "success", title: "Branch copied", description: branch });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy branch",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  return useCallback(
    (draftId: DraftId, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        const session = useComposerDraftStore.getState().getDraftSession(draftId);
        if (!api || !session || session.promotedTo) return;
        const project = resolveProject(session);
        const workspacePath = session.worktreePath ?? resolveWorkspaceRoot(session);
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildDraftActionMenuItems({
              hasPath: Boolean(workspacePath),
              hasBranch: Boolean(session.branch),
              hasProject: project !== null,
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "project-settings":
            if (project !== null) openProjectSettings(project);
            return;
          case "copy-path":
            if (workspacePath) copyPathToClipboard(workspacePath, { path: workspacePath });
            return;
          case "copy-branch":
            if (session.branch) copyBranchToClipboard(session.branch, { branch: session.branch });
            return;
          case "discard": {
            // The menu can stay open while the draft sends; discarding a
            // promoting draft would strand the send.
            const current = useComposerDraftStore.getState().getDraftSession(draftId);
            if (current && !current.promotedTo) discardComposerDraft(draftId);
            return;
          }
        }
      })();
    },
    [
      copyBranchToClipboard,
      copyPathToClipboard,
      openProjectSettings,
      resolveProject,
      resolveWorkspaceRoot,
    ],
  );
}
