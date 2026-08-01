import { useAtomValue } from "@effect/atom-react";
import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import type {
  EnvironmentId,
  OrchestrationThreadActivity,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { environmentThreadDetails, environmentThreadShells } from "./threads";

const EMPTY_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = Object.freeze([]);
const EMPTY_ACTIVITIES_ATOM = Atom.make(EMPTY_ACTIVITIES).pipe(
  Atom.withLabel("web-rate-limit-activities:empty"),
);

/**
 * Newest `account.rate-limits.updated` activity for a single thread, scanning
 * from the end since activities are appended in arrival order.
 */
function latestRateLimitActivityForThread(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): OrchestrationThreadActivity | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity && activity.kind === "account.rate-limits.updated") {
      return activity;
    }
  }
  return null;
}

/**
 * Latest `account.rate-limits.updated` activity for every thread bound to the
 * given provider instance in one environment. Rate limits describe an
 * account/subscription rather than a single conversation, so the quota meter
 * selects the newest complete snapshot across that environment's threads
 * instead of showing only the active thread's last-seen figures — which go
 * stale while another conversation on the same subscription keeps reporting
 * fresher usage.
 *
 * Memoized on the element identities so the meter only re-derives when an actual
 * rate-limit activity changes.
 */
const latestRateLimitActivitiesForEnvironmentAtomFamily = Atom.family(
  (environmentId: EnvironmentId) =>
    Atom.family((instanceId: ProviderInstanceId) => {
      let previous: ReadonlyArray<OrchestrationThreadActivity> = [];
      return Atom.make((get): ReadonlyArray<OrchestrationThreadActivity> => {
        const next: OrchestrationThreadActivity[] = [];
        for (const ref of get(environmentThreadShells.environmentThreadRefsAtom(environmentId))) {
          const shell = get(environmentThreadShells.threadShellAtom(ref));
          if (!shell || shell.modelSelection.instanceId !== instanceId) {
            continue;
          }
          const activity = latestRateLimitActivityForThread(
            get(environmentThreadDetails.activitiesAtom(ref)),
          );
          if (activity) {
            next.push(activity);
          }
        }
        if (arrayElementsEqual(previous, next)) {
          return previous;
        }
        previous = next;
        return previous;
      }).pipe(Atom.withLabel(`web-rate-limit-activities:${environmentId}:${instanceId}`));
    }),
);

export function useLatestRateLimitActivitiesForEnvironmentInstance(
  environmentId: EnvironmentId | null | undefined,
  instanceId: ProviderInstanceId | null | undefined,
): ReadonlyArray<OrchestrationThreadActivity> {
  return useAtomValue(
    environmentId == null || instanceId == null
      ? EMPTY_ACTIVITIES_ATOM
      : latestRateLimitActivitiesForEnvironmentAtomFamily(environmentId)(instanceId),
  );
}
