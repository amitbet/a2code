import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationThreadActivity,
  type OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  projectThreadSnapshotForClient,
  shouldSendThreadEventToClient,
} from "./ClientProjection.ts";

const rateLimitActivity = {
  id: EventId.make("rate-limit-1"),
  turnId: null,
  kind: "account.rate-limits.updated",
  tone: "info",
  summary: "Account rate limits updated",
  payload: { snapshot: { windows: [] } },
  createdAt: "2026-07-11T00:00:00.000Z",
} satisfies OrchestrationThreadActivity;

const snapshot = {
  snapshotSequence: 5,
  thread: {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    pinnedAt: null,
    settledOverride: null,
    settledAt: null,
    messages: [],
    proposedPlans: [],
    activities: [rateLimitActivity],
    checkpoints: [],
    queuedPrompts: [],
    session: null,
  },
} satisfies OrchestrationThreadDetailSnapshot;

const event = {
  eventId: EventId.make("event-1"),
  sequence: 5,
  aggregateKind: "thread",
  aggregateId: ThreadId.make("thread-1"),
  occurredAt: "2026-07-11T00:00:00.000Z",
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  type: "thread.activity-appended",
  payload: {
    threadId: ThreadId.make("thread-1"),
    activity: rateLimitActivity,
  },
} satisfies OrchestrationEvent;

describe("mobile thread projection", () => {
  it("removes rate limit activities from mobile snapshots and events", () => {
    expect(projectThreadSnapshotForClient(snapshot, "mobile").thread.activities).toEqual([]);
    expect(shouldSendThreadEventToClient(event, "mobile")).toBe(false);
  });

  it("preserves rate limit activities for desktop and web clients", () => {
    expect(projectThreadSnapshotForClient(snapshot, "desktop")).toBe(snapshot);
    expect(shouldSendThreadEventToClient(event, "desktop")).toBe(true);
  });
});
