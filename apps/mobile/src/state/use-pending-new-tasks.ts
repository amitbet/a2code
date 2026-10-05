import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useMachineEnvironmentId } from "./machineScope";
import { buildPendingNewTasks, type PendingNewTask } from "./pending-new-tasks-model";
import { flattenQueuedThreadMessages } from "./thread-outbox-model";
import { composerDraftsAtom } from "./use-composer-drafts";
import { useThreadOutboxMessages } from "./use-thread-outbox";

export type {
  PendingDraftTask,
  PendingNewTask,
  PendingQueuedTask,
} from "./pending-new-tasks-model";

/**
 * Pending new tasks for presentation, scoped to the machine switcher's
 * environment unless `scopedEnvironmentId` overrides it (`null` = every
 * environment). Only presentation is scoped; the outbox drain stays global.
 */
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
    // A null machine scope is "no filter" (still resolving), not "nothing".
    return environmentId === null
      ? tasks
      : tasks.filter((task) => task.environmentId === environmentId);
  }, [environmentId, queuedMessagesByThreadKey, drafts]);
}
