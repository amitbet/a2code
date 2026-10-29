import type {
  EditorId,
  EnvironmentId,
  EnvironmentMachineKind,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { memo } from "react";

import type { DraftId } from "../../composerDraftStore";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import BaseGitActionsControl from "../GitActionsControl";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { OpenInPicker } from "./OpenInPicker";

const GitActionsControl = memo(BaseGitActionsControl);

/**
 * The thread details card's essentials, for when the card is off screen. A narrow window turns
 * the card into a popover that starts closed, and the machine, editor and git controls would
 * otherwise vanish with it.
 */
export const ThreadHeaderQuickActions = memo(function ThreadHeaderQuickActions(props: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  draftId: DraftId | undefined;
  machine: { label: string; kind: EnvironmentMachineKind } | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  showOpenInPicker: boolean;
  gitCwd: string | null;
  showGitActions: boolean;
  onOpenChanges: (() => void) | undefined;
}) {
  return (
    <div
      className="@container/header-actions hidden min-w-0 shrink-0 items-center gap-1.5 sm:flex [-webkit-app-region:no-drag]"
      data-thread-header-quick-actions
    >
      {props.machine ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex min-w-0 max-w-36 items-center gap-1 text-muted-foreground text-xs" />
            }
          >
            <EnvironmentMachineIcon aria-hidden kind={props.machine.kind} className="size-3" />
            <span className="truncate">{props.machine.label}</span>
          </TooltipTrigger>
          <TooltipPopup side="bottom">Runs on {props.machine.label}</TooltipPopup>
        </Tooltip>
      ) : null}
      {props.showOpenInPicker ? (
        <OpenInPicker
          keybindings={props.keybindings}
          environmentId={props.environmentId}
          availableEditors={props.availableEditors}
          openInCwd={props.gitCwd}
          // ChatView owns the favorite-editor shortcut; a second listener would open twice.
          enableShortcut={false}
          compact
        />
      ) : null}
      {props.showGitActions ? (
        <GitActionsControl
          gitCwd={props.gitCwd}
          activeThreadRef={props.threadRef}
          {...(props.draftId ? { draftId: props.draftId } : {})}
          {...(props.onOpenChanges ? { onOpenChanges: props.onOpenChanges } : {})}
        />
      ) : null}
    </div>
  );
});
