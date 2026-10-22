import { use, useMemo } from "react";
import { CheckIcon, MessageCircleIcon } from "lucide-react";
import type { MessagesTimelineRow as TimelineRow } from "./MessagesTimeline.logic";
import { TimelineRowCtx } from "./timelineRowContext";
import { MessageAuthorHeading } from "./TimelineRowParts";
import { useAssetUrls } from "../../assets/assetUrls";
export function UserInputAnswerTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "user-input" }>;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="relative max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground">
        <MessageAuthorHeading>You answered</MessageAuthorHeading>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MessageCircleIcon className="size-3.5" aria-hidden />
          <span>Answered</span>
        </div>
        <div className="flex flex-col gap-3">
          {row.exchange.answers.map((answer) => (
            <div key={answer.questionId} className="flex min-w-0 flex-col gap-1">
              {answer.header ? (
                <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {answer.header}
                </span>
              ) : null}
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{answer.question}</p>
              {answer.values.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {answer.values.map((value) => (
                    <span
                      key={value}
                      className="inline-flex min-w-0 items-start gap-1 whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background/60 px-2 py-0.5 text-sm text-foreground"
                    >
                      <CheckIcon className="mt-1 size-3 shrink-0 text-primary" aria-hidden />
                      {value}
                    </span>
                  ))}
                  {answer.custom ? (
                    <span className="text-2xs uppercase tracking-wide text-muted-foreground/70">
                      custom
                    </span>
                  ) : null}
                </div>
              ) : answer.attachments.length === 0 ? (
                <span className="text-xs italic text-muted-foreground/70">No answer</span>
              ) : null}
              <QuestionAnswerAttachments attachments={answer.attachments} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuestionAnswerAttachments({
  attachments,
}: {
  attachments: import("@t3tools/contracts").UserInputAttachments[string];
}) {
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const resources = (() =>
    attachments.map((attachment) => ({
      _tag: "attachment" as const,
      attachmentId: attachment.id,
    })))();
  const urls = useAssetUrls(activeThreadEnvironmentId, resources);
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((attachment, index) => {
        const url = urls[index];
        return (
          <a
            key={attachment.id}
            href={url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            {attachment.type === "image" && url ? (
              <img
                src={url}
                alt={attachment.name}
                className="h-20 max-w-32 rounded object-contain"
              />
            ) : (
              attachment.name
            )}
          </a>
        );
      })}
    </div>
  );
}
