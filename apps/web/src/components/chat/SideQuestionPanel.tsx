/**
 * `/btw` side questions beside their parent thread: the chip strip above the
 * parent's composer, the right-panel surface that shows one side question's
 * conversation, and the tab label for that surface.
 *
 * The panel is deliberately slim: the answer, a follow-up box, and the ways
 * out (open as a thread, promote to a regular thread, dismiss). Anything
 * richer, such as answering an approval request, happens in the full thread
 * view.
 */
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { isSideQuestion } from "@t3tools/client-runtime/state/side-questions";
import { type EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { ArrowUp, CircleStop, ExternalLink, GitFork, MessageCircleQuestion, X } from "lucide-react";
import { memo, useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolveThreadStatusPill } from "~/components/Sidebar.logic";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useThreadActions } from "~/hooks/useThreadActions";
import { cn, newMessageId } from "~/lib/utils";
import {
  useProject,
  useSideQuestionShells,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";

type SideQuestionShell = NonNullable<ReturnType<typeof useThreadShell>>;

interface SideQuestionMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly streaming: boolean;
}

function sideQuestionStatusLabel(shell: SideQuestionShell): string {
  return resolveThreadStatusPill({ thread: shell })?.label ?? "Answered";
}

/** Tab label for a side-question surface: the side question's title. */
export function SideQuestionTabTitle(props: { environmentId: EnvironmentId; threadId: string }) {
  const shell = useThreadShell(scopeThreadRef(props.environmentId, ThreadId.make(props.threadId)));
  return <>{shell?.title ?? "Side question"}</>;
}

/**
 * One chip per unarchived side question of `parentRef`, shown above the
 * parent's composer. Renders nothing when there are none.
 */
export const SideQuestionChips = memo(function SideQuestionChips(props: {
  parentRef: ScopedThreadRef;
  onOpen: (sideQuestionThreadId: ThreadId) => void;
}) {
  const sideQuestions = useSideQuestionShells(props.parentRef);
  if (sideQuestions.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1.5" data-side-question-chips>
      {sideQuestions.map((shell) => {
        const running = threadRuntimeIsActive(shell.runtime);
        const needsAttention = shell.hasPendingApprovals || shell.hasPendingUserInput;
        return (
          <Button
            key={shell.id}
            variant="outline"
            size="micro"
            onClick={() => props.onOpen(shell.id)}
            aria-label={`Side question: ${shell.title} (${sideQuestionStatusLabel(shell)})`}
          >
            {running ? (
              <Spinner size="xs" tone="muted" />
            ) : (
              <MessageCircleQuestion className={cn(needsAttention && "text-warning-foreground")} />
            )}
            <span className="max-w-48 truncate">{shell.title}</span>
          </Button>
        );
      })}
    </div>
  );
});

/** Right-panel surface for one side question. */
export function SideQuestionPanel(props: {
  environmentId: EnvironmentId;
  sideQuestionThreadId: string;
  onClose: () => void;
}) {
  const { onClose } = props;
  const router = useRouter();
  const sideQuestionRef = useMemo(
    () => scopeThreadRef(props.environmentId, ThreadId.make(props.sideQuestionThreadId)),
    [props.environmentId, props.sideQuestionThreadId],
  );
  const shell = useThreadShell(sideQuestionRef);
  const turnItems = useThreadVisibleTurnItems(sideQuestionRef);
  const project = useProject(shell ? scopeProjectRef(props.environmentId, shell.projectId) : null);
  const { archiveThread, promoteSideQuestion } = useThreadActions();
  const startTurn = useAtomCommand(threadEnvironment.startTurn);
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn);
  const [followUp, setFollowUp] = useState("");

  const running = shell ? threadRuntimeIsActive(shell.runtime) : false;
  const stillSideQuestion = shell ? isSideQuestion(shell) : false;
  const messages = useMemo(
    () =>
      turnItems.flatMap(({ item }): SideQuestionMessage[] => {
        if (item.type === "user_message") {
          return [{ id: item.id, role: "user", text: item.text, streaming: false }];
        }
        if (item.type === "assistant_message") {
          return [{ id: item.id, role: "assistant", text: item.text, streaming: item.streaming }];
        }
        return [];
      }),
    [turnItems],
  );
  const cwd = shell?.worktreePath ?? project?.workspaceRoot ?? undefined;

  const openAsThread = useCallback(() => {
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(sideQuestionRef),
    });
  }, [router, sideQuestionRef]);

  const promote = useCallback(async () => {
    const result = await promoteSideQuestion(sideQuestionRef);
    if (result._tag === "Success") {
      onClose();
      openAsThread();
    }
  }, [onClose, openAsThread, promoteSideQuestion, sideQuestionRef]);

  const dismiss = useCallback(async () => {
    const result = await archiveThread(sideQuestionRef);
    if (result._tag === "Success") {
      onClose();
    }
  }, [archiveThread, onClose, sideQuestionRef]);

  const stop = useCallback(() => {
    void interruptTurn({
      environmentId: props.environmentId,
      input: { threadId: sideQuestionRef.threadId },
    });
  }, [interruptTurn, props.environmentId, sideQuestionRef.threadId]);

  // A follow-up sent while the answer is running queues behind it on the server.
  const sendFollowUp = useCallback(() => {
    const text = followUp.trim();
    if (text.length === 0 || shell === null) return;
    void startTurn({
      environmentId: props.environmentId,
      input: {
        threadId: sideQuestionRef.threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
      },
    });
    setFollowUp("");
  }, [followUp, props.environmentId, shell, sideQuestionRef.threadId, startTurn]);

  const onFollowUpKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        sendFollowUp();
      }
    },
    [sendFollowUp],
  );

  if (shell === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
        This side question is no longer available.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-side-question-panel>
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <MessageCircleQuestion className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">{shell.title}</span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {sideQuestionStatusLabel(shell)}
          </span>
        </div>
        {running ? (
          <SideQuestionAction label="Stop" onClick={stop}>
            <CircleStop />
          </SideQuestionAction>
        ) : null}
        {stillSideQuestion ? (
          <SideQuestionAction label="Promote to thread" onClick={() => void promote()}>
            <GitFork />
          </SideQuestionAction>
        ) : null}
        <SideQuestionAction label="Open as thread" onClick={openAsThread}>
          <ExternalLink />
        </SideQuestionAction>
        <SideQuestionAction
          label={running ? "Stop the answer before dismissing" : "Dismiss"}
          disabled={running}
          onClick={() => void dismiss()}
        >
          <X />
        </SideQuestionAction>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {messages.map((message) =>
            message.role === "user" ? (
              <div
                key={message.id}
                className="self-end max-w-[85%] whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2 text-sm"
              >
                {message.text}
              </div>
            ) : (
              <ChatMarkdown
                key={message.id}
                text={message.text}
                cwd={cwd}
                threadRef={sideQuestionRef}
                isStreaming={message.streaming}
              />
            ),
          )}
          {running && !messages.some((message) => message.streaming) ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner size="xs" />
              Looking into it…
            </div>
          ) : null}
          {shell.hasPendingApprovals || shell.hasPendingUserInput ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
              <span>
                {shell.hasPendingApprovals
                  ? "The side question is waiting for your approval."
                  : "The side question is waiting for your answer."}
              </span>
              <Button variant="outline" size="micro" onClick={openAsThread}>
                Open to respond
              </Button>
            </div>
          ) : null}
        </div>
      </ScrollArea>
      <div className="flex items-end gap-2 border-t p-2">
        <Textarea
          size="sm"
          value={followUp}
          placeholder="Ask a follow-up"
          aria-label="Side question follow-up"
          onChange={(event) => setFollowUp(event.target.value)}
          onKeyDown={onFollowUpKeyDown}
        />
        <Button
          size="icon-sm"
          aria-label="Send follow-up"
          disabled={followUp.trim().length === 0}
          onClick={sendFollowUp}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}

function SideQuestionAction(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}
