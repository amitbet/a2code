import { describe, expect, it } from "vite-plus/test";
import { ApprovalRequestId, type UserInputAttachmentAnswerPayload } from "@t3tools/contracts";
import { buildUserInputExchangeAnswers, getQuestionTextPreview } from "./userInput.ts";

function answer(
  overrides: Partial<UserInputAttachmentAnswerPayload> = {},
): UserInputAttachmentAnswerPayload {
  return {
    requestId: ApprovalRequestId.make("request-1"),
    questionTextById: { scope: "Which repository?" },
    answers: { scope: "Use the private repository" },
    attachmentsByQuestionId: {},
    ...overrides,
  };
}

describe("getQuestionTextPreview", () => {
  it("joins the question texts", () => {
    expect(
      getQuestionTextPreview(
        answer({ questionTextById: { scope: "Which repository?", name: "What name?" } }),
      ),
    ).toBe("Which repository? · What name?");
  });

  it("normalizes whitespace and skips blank texts", () => {
    expect(
      getQuestionTextPreview(
        answer({ questionTextById: { scope: "Which\nrepository?", x: "  " } }),
      ),
    ).toBe("Which repository?");
  });

  it("returns an empty string without question texts", () => {
    expect(getQuestionTextPreview(answer({ questionTextById: undefined }))).toBe("");
  });
});

describe("buildUserInputExchangeAnswers", () => {
  const questions = [
    {
      id: "auth",
      header: "Auth",
      question: "Which auth method?",
      options: [
        { label: "OAuth", description: "Use OAuth", value: "oauth" },
        { label: "API key", description: "Use a key" },
      ],
    },
    { id: "name", header: "Name", question: "What name?", options: [] },
    {
      id: "region",
      header: "Region",
      question: "Which region?",
      options: [{ label: "EU", description: "Europe" }],
      allowCustomAnswer: true,
    },
  ];

  it("pairs answers with questions in asked order and shows option labels", () => {
    const answers = buildUserInputExchangeAnswers(
      questions,
      answer({ answers: { region: "  APAC ", auth: ["oauth", "API key"] }, questionTextById: {} }),
    );
    expect(
      answers.map((entry) => [entry.header, entry.question, entry.values, entry.custom]),
    ).toEqual([
      ["Auth", "Which auth method?", ["OAuth", "API key"], false],
      ["Name", "What name?", [], false],
      ["Region", "Which region?", ["APAC"], true],
    ]);
  });

  it("keeps answers for questions the request no longer lists", () => {
    const answers = buildUserInputExchangeAnswers(
      [],
      answer({
        questionTextById: { scope: "Which repository?" },
        answers: { scope: { answers: ["private"] } },
      }),
    );
    expect(answers).toEqual([
      {
        questionId: "scope",
        header: null,
        question: "Which repository?",
        values: ["private"],
        custom: false,
        attachments: [],
      },
    ]);
  });
});
