import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { environmentShell, environmentShellSummaryAtom } from "./shell";
import { projectWorkspaceState } from "./workspaceModel";
import { environmentCatalog } from "../connection/catalog";
import { environmentPresentations } from "./presentation";
import { createWorkspaceConnectionAtoms } from "./workspace-connection-atoms";

export const workspaceConnections = createWorkspaceConnectionAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  networkStatusValueAtom: environmentCatalog.networkStatusValueAtom,
  presentationAtom: environmentPresentations.presentationAtom,
});

export function useWorkspaceEnvironments() {
  return useAtomValue(workspaceConnections.environmentsAtom);
}

export function useWorkspaceConnectionState() {
  return useAtomValue(workspaceConnections.stateAtom);
}

export function useConnectionsReady() {
  return useAtomValue(workspaceConnections.isReadyAtom);
}

const EMPTY_SELECTED_SHELL_STATE_ATOM = Atom.make<EnvironmentShellState>({
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
}).pipe(Atom.withLabel("mobile:workspace-selected-shell:empty"));

// Primitive selectors keep snapshot content updates from re-rendering callers.
const selectShellHasSnapshot = (state: EnvironmentShellState) => Option.isSome(state.snapshot);
const selectShellStatus = (state: EnvironmentShellState) => state.status;
const selectShellError = (state: EnvironmentShellState) => Option.getOrNull(state.error);

/**
 * Connection and shell status for the workspace. Pass the machine-switcher
 * environment to project status for that machine only; `null` aggregates
 * every environment.
 */
export function useWorkspaceState(environmentId: EnvironmentId | null = null) {
  const isReady = useConnectionsReady();
  const networkStatus = useAtomValue(environmentCatalog.networkStatusValueAtom);
  const allEnvironments = useWorkspaceEnvironments();
  const allShellSummary = useAtomValue(environmentShellSummaryAtom);
  const selectedShellAtom =
    environmentId === null
      ? EMPTY_SELECTED_SHELL_STATE_ATOM
      : environmentShell.stateValueAtom(environmentId);
  const selectedHasSnapshot = useAtomValue(selectedShellAtom, selectShellHasSnapshot);
  const selectedStatus = useAtomValue(selectedShellAtom, selectShellStatus);
  const selectedError = useAtomValue(selectedShellAtom, selectShellError);
  const shellSummary = useMemo(
    () =>
      environmentId === null
        ? allShellSummary
        : {
            hasSnapshot: selectedHasSnapshot,
            hasSynchronizingShell: selectedStatus === "synchronizing",
            hasCachedShell: selectedStatus === "cached",
            hasLiveShell: selectedStatus === "live",
            firstError: selectedError,
          },
    [allShellSummary, environmentId, selectedError, selectedHasSnapshot, selectedStatus],
  );
  const projectedEnvironments = useMemo(
    () =>
      environmentId === null
        ? allEnvironments
        : allEnvironments.filter((environment) => environment.environmentId === environmentId),
    [allEnvironments, environmentId],
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
