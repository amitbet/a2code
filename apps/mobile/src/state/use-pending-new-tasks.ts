import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import { buildPendingNewTasks, type PendingNewTask } from "./pending-new-tasks-model";
import { flattenQueuedThreadMessages } from "./thread-outbox-model";
import { composerDraftsAtom } from "./use-composer-drafts";
import { useThreadOutboxMessages } from "./use-thread-outbox";
import { useMachineEnvironmentId } from "./machineScope";

export type {
  PendingDraftTask,
  PendingNewTask,
  PendingQueuedTask,
} from "./pending-new-tasks-model";

export function usePendingNewTasks(
  scopedEnvironmentId?: EnvironmentId | null,
): ReadonlyArray<PendingNewTask> {
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const drafts = useAtomValue(composerDraftsAtom);
  const machineEnvironmentId = useMachineEnvironmentId();
  const environmentId =
    scopedEnvironmentId === undefined ? machineEnvironmentId : scopedEnvironmentId;
  return useMemo(() => {
    const tasks = buildPendingNewTasks({
      queuedMessages: flattenQueuedThreadMessages(queuedMessagesByThreadKey),
      drafts,
    });
    // A null machine scope is "no filter" (the cross-machine overview), not "nothing".
    return environmentId === null
      ? tasks
      : tasks.filter((task) => task.environmentId === environmentId);
  }, [environmentId, queuedMessagesByThreadKey, drafts]);
}
