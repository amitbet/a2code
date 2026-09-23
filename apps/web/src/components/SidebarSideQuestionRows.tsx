import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { SidebarMenuSubButton, SidebarMenuSubItem } from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { useSideQuestionShells } from "~/state/entities";

/**
 * The `/btw` side questions asked from one thread, listed under that thread's
 * sidebar row. Collapsed to a count by default; always expanded while one of
 * them is the open thread so the active row stays visible.
 */
export const SidebarSideQuestionRows = memo(function SidebarSideQuestionRows(props: {
  parentRef: ScopedThreadRef;
  activeRouteThreadKey: string | null;
  onOpen: (threadRef: ScopedThreadRef) => void;
}) {
  const sideQuestions = useSideQuestionShells(props.parentRef);
  const [expanded, setExpanded] = useState(false);
  const toggleRender = useMemo(() => <button type="button" />, []);
  const rowRender = useMemo(() => <button type="button" />, []);
  if (sideQuestions.length === 0) {
    return null;
  }
  const refs = sideQuestions.map((shell) => scopeThreadRef(shell.environmentId, shell.id));
  const containsActive = refs.some((ref) => scopedThreadKey(ref) === props.activeRouteThreadKey);
  const showRows = expanded || containsActive;
  const label =
    sideQuestions.length === 1 ? "1 side question" : `${sideQuestions.length} side questions`;

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
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
      {showRows
        ? sideQuestions.map((shell, index) => {
            const ref = refs[index]!;
            const running =
              shell.session?.status === "running" || shell.session?.status === "starting";
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
                  {running ? (
                    <Spinner size="xs" tone="muted" />
                  ) : (
                    <MessageCircleQuestion className="size-3" />
                  )}
                  <span>{shell.title}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })
        : null}
    </>
  );
});
