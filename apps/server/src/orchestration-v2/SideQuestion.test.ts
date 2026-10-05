import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import {
  SIDE_QUESTION_INSTRUCTIONS,
  SIDE_QUESTION_MAX_UNARCHIVED_PER_PARENT,
  sideQuestionTurnNote,
} from "./SideQuestion.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };
const adapter: ProviderAdapterV2Shape = {
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  // The effect worker is off: dispatch decisions are inspected, never executed.
  openSession: () => Effect.die("Side question tests inspect dispatch only"),
};
const layer = makeOrchestratorV2ReplayLayerWithRegistry(
  { name: "side-question" },
  ProviderAdapterRegistry.makeLayer([adapter]),
  { runEffectWorker: false },
);

const parentThreadId = ThreadId.make("side-question-parent");
const runningRunId = RunId.make("side-question-parent-run");

/** A parent whose second turn is still running: partial answer and a command in flight. */
const seedParent = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create-parent"),
    threadId: parentThreadId,
    projectId: ProjectId.make("side-question-project"),
    title: "Parent work",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "plan",
    branch: "feature/side",
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  const base = {
    threadId: parentThreadId,
    runId: runningRunId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    title: null,
    startedAt: now,
    updatedAt: now,
  } as const;
  const items: ReadonlyArray<OrchestrationV2TurnItem> = [
    {
      ...base,
      id: TurnItemId.make("parent-user"),
      ordinal: 1,
      status: "completed",
      completedAt: now,
      type: "user_message",
      createdBy: "user",
      creationSource: "web",
      inputIntent: "turn_start",
      messageId: MessageId.make("parent-user-message"),
      text: "PARENT_REQUEST_MARKER",
      attachments: [],
    },
    {
      ...base,
      id: TurnItemId.make("parent-assistant"),
      ordinal: 2,
      status: "running",
      completedAt: null,
      type: "assistant_message",
      messageId: MessageId.make("parent-assistant-message"),
      text: "RUNNING_ANSWER_MARKER",
      streaming: true,
    },
    {
      ...base,
      id: TurnItemId.make("parent-command"),
      ordinal: 3,
      status: "running",
      completedAt: null,
      type: "command_execution",
      input: "RUNNING_COMMAND_MARKER",
    },
  ];
  yield* eventSink.write({
    events: [
      {
        id: EventId.make("parent-run"),
        type: "run.created",
        threadId: parentThreadId,
        runId: runningRunId,
        occurredAt: now,
        payload: {
          id: runningRunId,
          threadId: parentThreadId,
          ordinal: 1,
          providerInstanceId: instanceId,
          modelSelection,
          providerThreadId: null,
          userMessageId: MessageId.make("parent-user-message"),
          rootNodeId: null,
          activeAttemptId: null,
          status: "running",
          queuePosition: null,
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          checkpointId: null,
          contextHandoffId: null,
        },
      },
      ...items.map((item) => ({
        id: EventId.make(`event-${item.id}`),
        type: "turn-item.updated" as const,
        threadId: parentThreadId,
        runId: runningRunId,
        occurredAt: now,
        payload: item,
      })),
    ],
  });
});

const ask = (index: number) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make(`side-question-${index}`);
    yield* orchestrator.dispatch({
      type: "thread.side-question.ask",
      commandId: CommandId.make(`ask-${index}`),
      sourceThreadId: parentThreadId,
      targetThreadId: threadId,
      messageId: MessageId.make(`ask-message-${index}`),
      question: `What is the agent doing? (${index})`,
      title: `Side question ${index}`,
      createdBy: "user",
      creationSource: "web",
    });
    return threadId;
  });

describe("thread.side-question.ask", () => {
  it.effect("creates a side question that starts with the parent's running turn", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* seedParent;
      const threadId = yield* ask(1);

      const side = yield* orchestrator.getThreadProjection(threadId);
      assert.strictEqual(side.thread.sideQuestionOf, parentThreadId);
      assert.deepStrictEqual(side.thread.lineage, {
        parentThreadId,
        relationshipToParent: null,
        rootThreadId: parentThreadId,
      });
      assert.isNull(side.thread.forkedFrom);
      assert.strictEqual(side.thread.projectId, ProjectId.make("side-question-project"));
      assert.strictEqual(side.thread.branch, "feature/side");
      assert.deepStrictEqual(side.thread.modelSelection, modelSelection);
      assert.strictEqual(side.thread.runtimeMode, "approval-required");
      assert.strictEqual(side.thread.interactionMode, "default");

      assert.lengthOf(side.runs, 1);
      const run = side.runs[0]!;
      assert.strictEqual(run.status, "starting");
      assert.strictEqual(
        side.messages.find((message) => message.role === "user")?.text,
        "What is the agent doing? (1)",
      );

      assert.lengthOf(side.contextHandoffs, 1);
      const handoff = side.contextHandoffs[0]!;
      assert.strictEqual(handoff.targetRunId, run.id);
      assert.strictEqual(handoff.status, "ready");
      assert.strictEqual(handoff.toProviderThreadId, run.providerThreadId);
      assert.strictEqual(run.contextHandoffId, handoff.id);
      assert.include(handoff.history?.coverage ?? "", parentThreadId);
      const history = handoff.history?.messages ?? [];
      const texts = history.map((message) => message.text).join("\n");
      assert.include(texts, "PARENT_REQUEST_MARKER");
      assert.include(texts, "RUNNING_ANSWER_MARKER");
      assert.include(texts, "RUNNING_COMMAND_MARKER");
      assert.isTrue(history.every((message) => message.runStatus === "running"));

      const shell = yield* orchestrator.getThreadShell(threadId);
      assert.strictEqual(shell?.sideQuestionOf, parentThreadId);
      const parentShell = yield* orchestrator.getThreadShell(parentThreadId);
      assert.isUndefined(parentShell?.sideQuestionOf);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps at most five unarchived side questions per parent", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* seedParent;
      const asked: Array<ThreadId> = [];
      for (let index = 1; index <= SIDE_QUESTION_MAX_UNARCHIVED_PER_PARENT + 1; index++) {
        asked.push(yield* ask(index));
      }
      const archived = yield* Effect.forEach(asked, (threadId) =>
        orchestrator
          .getThreadShell(threadId)
          .pipe(Effect.map((shell) => shell?.archivedAt !== null)),
      );
      assert.deepStrictEqual(archived, [true, false, false, false, false, false]);
      const parent = yield* orchestrator.getThreadShell(parentThreadId);
      assert.isNull(parent?.archivedAt);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects a side question asked from another side question", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* seedParent;
      const sideThreadId = yield* ask(1);
      const result = yield* orchestrator
        .dispatch({
          type: "thread.side-question.ask",
          commandId: CommandId.make("ask-nested"),
          sourceThreadId: sideThreadId,
          targetThreadId: ThreadId.make("side-question-nested"),
          messageId: MessageId.make("ask-nested-message"),
          question: "Nested?",
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.result);
      assert.strictEqual(result._tag, "Failure");
    }).pipe(Effect.provide(layer)),
  );
});

describe("thread.side-question.promote", () => {
  it.effect("turns a side question into a regular thread", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* seedParent;
      const threadId = yield* ask(1);
      yield* orchestrator.dispatch({
        type: "thread.side-question.promote",
        commandId: CommandId.make("promote-1"),
        threadId,
      });

      const promoted = yield* orchestrator.getThreadProjection(threadId);
      assert.isNull(promoted.thread.sideQuestionOf ?? null);
      assert.strictEqual(promoted.thread.runtimeMode, "full-access");
      assert.strictEqual(promoted.thread.lineage.parentThreadId, parentThreadId);
      const shell = yield* orchestrator.getThreadShell(threadId);
      assert.isUndefined(shell?.sideQuestionOf);
      assert.strictEqual(sideQuestionTurnNote(promoted.thread), "");

      const again = yield* orchestrator
        .dispatch({
          type: "thread.side-question.promote",
          commandId: CommandId.make("promote-again"),
          threadId,
        })
        .pipe(Effect.result);
      assert.strictEqual(again._tag, "Failure");
    }).pipe(Effect.provide(layer)),
  );
});

describe("sideQuestionTurnNote", () => {
  it("tells a side question not to change the checkout", () => {
    assert.strictEqual(
      sideQuestionTurnNote({ sideQuestionOf: parentThreadId }),
      SIDE_QUESTION_INSTRUCTIONS,
    );
    assert.strictEqual(sideQuestionTurnNote({ sideQuestionOf: null }), "");
    assert.strictEqual(sideQuestionTurnNote({}), "");
  });
});
