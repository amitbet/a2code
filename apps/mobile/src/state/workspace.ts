import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { environmentShell, environmentShellSummaryAtom } from "./shell";
import { projectWorkspaceEnvironment, projectWorkspaceState } from "./workspaceModel";
import { useEnvironments } from "./environments";

const EMPTY_SELECTED_SHELL_STATE = Atom.make<EnvironmentShellState>({
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
});

export function useWorkspaceState(environmentId: EnvironmentId | null = null) {
  const { isReady, networkStatus, environments } = useEnvironments();
  const allShellSummary = useAtomValue(environmentShellSummaryAtom);
  const selectedShellState = useAtomValue(
    environmentId === null
      ? EMPTY_SELECTED_SHELL_STATE
      : environmentShell.stateValueAtom(environmentId),
  );
  const shellSummary = useMemo(() => {
    if (environmentId === null) {
      return allShellSummary;
    }
    return {
      hasSnapshot: Option.isSome(selectedShellState.snapshot),
      hasSynchronizingShell: selectedShellState.status === "synchronizing",
      hasCachedShell: selectedShellState.status === "cached",
      hasLiveShell: selectedShellState.status === "live",
      firstError: Option.getOrNull(selectedShellState.error),
      latestSnapshotUpdatedAt: Option.match(selectedShellState.snapshot, {
        onNone: () => null,
        onSome: (snapshot) => snapshot.updatedAt,
      }),
    };
  }, [allShellSummary, environmentId, selectedShellState]);
  const projectedEnvironments = useMemo(
    () =>
      environments
        .filter(
          (environment) => environmentId === null || environment.environmentId === environmentId,
        )
        .map(projectWorkspaceEnvironment),
    [environmentId, environments],
  );
  const state = useMemo(
    () =>
      projectWorkspaceState({
        isReady,
        networkStatus,
        environments: projectedEnvironments,
        shellSummary,
      }),
    [isReady, networkStatus, projectedEnvironments, shellSummary],
  );

  return {
    environments: projectedEnvironments,
    state,
  };
}
