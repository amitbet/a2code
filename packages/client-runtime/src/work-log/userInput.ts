import {
  type OrchestrationV2UserInputQuestion,
  type UserInputAttachmentAnswerPayload,
  type UserInputAttachments,
} from "@t3tools/contracts";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function getQuestionAnswerText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(getQuestionAnswerText).filter(Boolean).join(", ");
  const nested = record(value);
  return nested ? getQuestionAnswerText(nested.answers) : "";
}

export function getQuestionTextPreview(answer: UserInputAttachmentAnswerPayload): string {
  return Object.values(answer.questionTextById ?? {})
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}

export function getQuestionAnswerPreview(answer: UserInputAttachmentAnswerPayload): string {
  const answers = Object.values(answer.answers).map(getQuestionAnswerText).filter(Boolean);
  const attachments = Object.values(answer.attachmentsByQuestionId)
    .flat()
    .map((attachment) => attachment.name);
  return (
    answers.length > 0
      ? answers.join(" · ")
      : attachments.length > 0
        ? attachments.join(", ")
        : Object.values(answer.questionTextById ?? {}).join(" · ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function hasQuestionAnswer(answer: UserInputAttachmentAnswerPayload): boolean {
  return (
    Object.values(answer.answers).some(getQuestionAnswerText) ||
    Object.values(answer.attachmentsByQuestionId).some((attachments) => attachments.length > 0)
  );
}

/** Flattens a stored answer value (string, list, or `{ answers }` record) into trimmed values. */
export function getQuestionAnswerValues(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap(getQuestionAnswerValues);
  const nested = record(value);
  return nested ? getQuestionAnswerValues(nested.answers) : [];
}

/** One asked question paired with what the user submitted for it. */
export interface UserInputExchangeAnswer {
  readonly questionId: string;
  /** Short question header (e.g. "Auth method"), when the original question is known. */
  readonly header: string | null;
  /** Full question text. Falls back to the question id when the question is unknown. */
  readonly question: string;
  /** Selected option label(s) or free-text answer. Empty when the question went unanswered. */
  readonly values: ReadonlyArray<string>;
  /** True when the question offered options and at least one value is free text instead. */
  readonly custom: boolean;
  readonly attachments: UserInputAttachments[string];
}

/**
 * Pairs a resolved request's questions with the submitted answers, in the
 * order the questions were asked. Answers for questions the request no longer
 * lists (older payloads) follow, labelled by their stored question text.
 */
export function buildUserInputExchangeAnswers(
  questions: ReadonlyArray<OrchestrationV2UserInputQuestion>,
  answer: UserInputAttachmentAnswerPayload,
): UserInputExchangeAnswer[] {
  const toAnswer = (
    questionId: string,
    question: OrchestrationV2UserInputQuestion | undefined,
  ): UserInputExchangeAnswer => {
    const options = question?.options ?? [];
    // Providers may store an option's value rather than its label; show the label.
    const values = getQuestionAnswerValues(answer.answers[questionId]).map(
      (value) => options.find((option) => option.value === value)?.label ?? value,
    );
    return {
      questionId,
      header: question?.header ?? null,
      question: question?.question ?? answer.questionTextById?.[questionId] ?? questionId,
      values,
      custom:
        options.length > 0 &&
        values.some((value) => !options.some((option) => option.label === value)),
      attachments: answer.attachmentsByQuestionId[questionId] ?? [],
    };
  };
  const asked = new Set(questions.map((question) => question.id));
  const extraIds = [
    ...new Set([
      ...Object.keys(answer.questionTextById ?? {}),
      ...Object.keys(answer.answers),
      ...Object.keys(answer.attachmentsByQuestionId),
    ]),
  ].filter((questionId) => !asked.has(questionId));
  return [
    ...questions.map((question) => toAnswer(question.id, question)),
    ...extraIds.map((questionId) => toAnswer(questionId, undefined)),
  ];
}
