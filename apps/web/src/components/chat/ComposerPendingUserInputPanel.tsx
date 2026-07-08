import { type ApprovalRequestId } from "@t3tools/contracts";
import { memo, useEffect, useEffectEvent, useRef, useState } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  collapsed: boolean;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onDismiss: () => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  collapsed,
  onToggleOption,
  onAdvance,
  onCollapse,
  onExpand,
  onDismiss,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      collapsed={collapsed}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onCollapse={onCollapse}
      onExpand={onExpand}
      onDismiss={onDismiss}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  collapsed,
  onToggleOption,
  onAdvance,
  onCollapse,
  onExpand,
  onDismiss,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  collapsed: boolean;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onDismiss: () => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const onAdvanceRef = useRef(onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionLabel: string;
  } | null>(null);

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    if (!activeQuestion || activeQuestion.multiSelect || !optimisticSingleSelect) {
      return;
    }
    if (optimisticSingleSelect.questionId !== activeQuestion.id) {
      setOptimisticSingleSelect(null);
      return;
    }
    if (
      progress.customAnswer.trim().length === 0 &&
      progress.selectedOptionLabels.includes(optimisticSingleSelect.optionLabel)
    ) {
      setOptimisticSingleSelect(null);
    }
  }, [
    activeQuestion,
    optimisticSingleSelect,
    progress.customAnswer,
    progress.selectedOptionLabels,
  ]);

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const handleOptionSelection = useEffectEvent((questionId: string, optionLabel: string) => {
    if (activeQuestion?.multiSelect) {
      onToggleOption(questionId, optionLabel);
      return;
    }
    setOptimisticSingleSelect({ questionId, optionLabel });
    onToggleOption(questionId, optionLabel);
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      onAdvanceRef.current();
    }, 200);
  });

  // Keyboard shortcut: number keys 1-9 select corresponding options when focus is
  // outside editable fields. Multi-select prompts toggle options in place; single-
  // select prompts keep the existing auto-advance behavior.
  useEffect(() => {
    if (!activeQuestion || collapsed || isResponding) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= activeQuestion.options.length) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      handleOptionSelection(activeQuestion.id, option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, collapsed, isResponding]);

  if (!activeQuestion) {
    return null;
  }

  const customAnswerActive = progress.customAnswer.trim().length > 0;
  const questionPositionLabel =
    prompt.questions.length > 1 ? `${questionIndex + 1}/${prompt.questions.length}` : null;

  if (collapsed) {
    return (
      <div className="flex min-w-0 items-center gap-2 px-3 py-2 sm:px-4">
        <button
          type="button"
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:ring-1 focus-visible:ring-primary/30"
          onClick={onExpand}
          aria-expanded="false"
          aria-label="Expand questions"
          title="Expand questions"
        >
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/65 transition-colors group-hover:text-muted-foreground" />
          <span className="shrink-0 text-[11px] font-semibold tracking-widest text-muted-foreground/55 uppercase">
            {activeQuestion.header}
          </span>
          {questionPositionLabel ? (
            <span className="flex h-5 shrink-0 items-center rounded-md bg-muted/60 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/60">
              {questionPositionLabel}
            </span>
          ) : null}
          <span className="min-w-0 truncate text-sm text-foreground/80">
            {activeQuestion.question}
          </span>
        </button>
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/65 outline-none transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
          onClick={onDismiss}
          aria-label="Dismiss questions"
          title="Dismiss questions"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[11px] font-semibold tracking-widest text-muted-foreground/55 uppercase">
          {activeQuestion.header}
        </span>
        {questionPositionLabel ? (
          <span className="flex h-5 items-center rounded-md bg-muted/60 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/60">
            {questionPositionLabel}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/65 outline-none transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
            onClick={onCollapse}
            aria-expanded="true"
            aria-label="Collapse questions"
            title="Collapse questions"
          >
            <ChevronUpIcon className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/65 outline-none transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
            onClick={onDismiss}
            aria-label="Dismiss questions"
            title="Dismiss questions"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
      <p className="text-sm text-foreground/90">{activeQuestion.question}</p>
      {activeQuestion.multiSelect ? (
        <p className="mt-1 text-xs text-muted-foreground/65">Select one or more options.</p>
      ) : null}
      <div className="mt-3 space-y-1.5">
        {activeQuestion.options.map((option, index) => {
          const isOptimisticallySelected =
            optimisticSingleSelect?.questionId === activeQuestion.id &&
            optimisticSingleSelect.optionLabel === option.label;
          const isSelected =
            isOptimisticallySelected ||
            (!customAnswerActive && progress.selectedOptionLabels.includes(option.label));
          const shortcutKey = index < 9 ? index + 1 : null;
          const className = cn(
            "group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left outline-none transition-all duration-150 focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/25",
            isSelected
              ? "border-primary/30 bg-primary/8 text-foreground"
              : "border-transparent bg-muted/22 text-foreground/85 hover:border-border/45 hover:bg-muted/34",
            isResponding && "opacity-50 cursor-not-allowed",
            !isResponding && "cursor-pointer",
          );
          const content = (
            <>
              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                <span className="text-sm font-medium">{option.label}</span>
                {option.description && option.description !== option.label ? (
                  <span className="text-xs text-muted-foreground/50">{option.description}</span>
                ) : null}
              </div>
              {isSelected ? (
                <CheckIcon className="size-3.5 shrink-0 text-primary" />
              ) : shortcutKey !== null ? (
                <kbd
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded border border-border/50 text-[11px] font-medium tabular-nums transition-colors duration-150",
                    "bg-background/35 text-muted-foreground/70 group-hover:border-border/70 group-hover:text-muted-foreground",
                  )}
                >
                  {shortcutKey}
                </kbd>
              ) : null}
            </>
          );
          return (
            <button
              key={`${activeQuestion.id}:${option.label}`}
              type="button"
              disabled={isResponding}
              onClick={() => {
                handleOptionSelection(activeQuestion.id, option.label);
              }}
              className={className}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
});
