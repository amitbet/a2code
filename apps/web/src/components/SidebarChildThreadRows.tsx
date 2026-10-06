import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { BotIcon, ChevronRight, MessageCircleQuestion, type LucideIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { SidebarMenuSubButton, SidebarMenuSubItem } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { useSideQuestionShells, useSubagentShells } from "~/state/entities";

interface ChildThreadRowsProps {
  parentRef: ScopedThreadRef;
  activeRouteThreadKey: string | null;
  onOpen: (threadRef: ScopedThreadRef) => void;
}

/**
 * Child threads listed under their parent's sidebar row. Collapsed to a count
 * by default; always expanded while one of them is the open thread so the
 * active row stays visible. A running child shows a spinner either way: the
 * toggle carries one while any child is working.
 */
const SidebarChildThreadRows = memo(function SidebarChildThreadRows(props: {
  shells: ReadonlyArray<EnvironmentThreadShell>;
  singularLabel: string;
  pluralLabel: string;
  icon: LucideIcon;
  activeRouteThreadKey: string | null;
  onOpen: (threadRef: ScopedThreadRef) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggleRender = useMemo(() => <button type="button" />, []);
  const rowRender = useMemo(() => <button type="button" />, []);
  const { shells } = props;
  if (shells.length === 0) {
    return null;
  }
  const refs = shells.map((shell) => scopeThreadRef(shell.environmentId, shell.id));
  const running = shells.map((shell) => threadRuntimeIsActive(shell.runtime));
  const anyRunning = running.some(Boolean);
  const containsActive = refs.some((ref) => scopedThreadKey(ref) === props.activeRouteThreadKey);
  const showRows = expanded || containsActive;
  const label =
    shells.length === 1 ? `1 ${props.singularLabel}` : `${shells.length} ${props.pluralLabel}`;
  const Icon = props.icon;

  return (
    <>
      <SidebarMenuSubItem className="ml-3 w-[calc(100%-0.75rem)]" data-thread-selection-safe>
        <SidebarMenuSubButton
          render={toggleRender}
          data-thread-selection-safe
          size="sm"
          aria-expanded={showRows}
          className="h-6 w-full translate-x-0 justify-start text-left"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight className={cn("size-3", showRows && "rotate-90")} />
          <span className="text-sidebar-muted-foreground">{label}</span>
          {!showRows && anyRunning ? <Spinner size="xs" tone="muted" /> : null}
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
      {showRows
        ? shells.map((shell, index) => {
            const ref = refs[index]!;
            return (
              <SidebarMenuSubItem
                key={shell.id}
                className="ml-6 w-[calc(100%-1.5rem)]"
                data-thread-selection-safe
              >
                <SidebarMenuSubButton
                  render={rowRender}
                  data-thread-selection-safe
                  size="sm"
                  isActive={scopedThreadKey(ref) === props.activeRouteThreadKey}
                  className="h-6 w-full translate-x-0 justify-start text-left"
                  onClick={() => props.onOpen(ref)}
                >
                  {running[index] ? (
                    <Spinner size="xs" tone="muted" />
                  ) : (
                    <Icon className="size-3" />
                  )}
                  <span className="truncate">{shell.title}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })
        : null}
    </>
  );
});

/** The `/btw` side questions asked from one thread. */
export const SidebarSideQuestionRows = memo(function SidebarSideQuestionRows(
  props: ChildThreadRowsProps,
) {
  const shells = useSideQuestionShells(props.parentRef);
  return (
    <SidebarChildThreadRows
      shells={shells}
      singularLabel="side question"
      pluralLabel="side questions"
      icon={MessageCircleQuestion}
      activeRouteThreadKey={props.activeRouteThreadKey}
      onOpen={props.onOpen}
    />
  );
});

/** The subagents spawned from one thread, provider-native or delegated. */
export const SidebarSubagentRows = memo(function SidebarSubagentRows(props: ChildThreadRowsProps) {
  const shells = useSubagentShells(props.parentRef);
  return (
    <SidebarChildThreadRows
      shells={shells}
      singularLabel="agent"
      pluralLabel="agents"
      icon={BotIcon}
      activeRouteThreadKey={props.activeRouteThreadKey}
      onOpen={props.onOpen}
    />
  );
});
