import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveNewThreadModelSelectionOverride,
  startNewThreadFromThread,
} from "./chatThreadActions";

const PROJECT_DEFAULT_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "project-default",
};
const CARRIED_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "carried-model",
};

describe("chatThreadActions", () => {
  it("does not carry a non-explicit model from the destination draft back into itself", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: null,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-a",
      }),
    ).toBeNull();
  });

  it("keeps the project default above any carried selection", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
      }),
    ).toEqual(PROJECT_DEFAULT_SELECTION);
  });

  it("starts a new thread on the same machine and project, keeping the branch only on request", async () => {
    const calls: unknown[][] = [];
    const handleNewThread = async (...args: unknown[]) => {
      calls.push(args);
    };
    const thread = {
      environmentId: EnvironmentId.make("env-remote"),
      projectId: ProjectId.make("project-1"),
      branch: "feat/menu",
      worktreePath: "/worktrees/feat-menu",
    };
    const projectRef = { environmentId: thread.environmentId, projectId: thread.projectId };

    await startNewThreadFromThread(handleNewThread, thread, false);
    await startNewThreadFromThread(handleNewThread, thread, true);

    expect(calls).toEqual([
      [projectRef],
      [
        projectRef,
        {
          branch: "feat/menu",
          worktreePath: "/worktrees/feat-menu",
          envMode: "worktree",
          startFromOrigin: false,
        },
      ],
    ]);
  });
});
