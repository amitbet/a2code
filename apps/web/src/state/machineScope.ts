import type { EnvironmentId } from "@t3tools/contracts";
import {
  isEnvironmentInMachineScope,
  isMachineOverviewSelected,
  MACHINE_SCOPE_OVERVIEW,
  type MachineScopeSelection,
  resolveMachineEnvironmentId,
} from "@t3tools/client-runtime/state/machine-scope";
import { Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../rpc/atomRegistry";

const MACHINE_SCOPE_STORAGE_KEY = "t3code:machine-scope:v1";

function readPersistedSelection(): MachineScopeSelection {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(MACHINE_SCOPE_STORAGE_KEY);
    if (!value || value.length === 0) {
      return null;
    }
    // The overview shares this key with machine ids: an environment id is never
    // the literal "overview", so one slot stays enough for the whole choice.
    return value === MACHINE_SCOPE_OVERVIEW ? MACHINE_SCOPE_OVERVIEW : (value as EnvironmentId);
  } catch {
    return null;
  }
}

function persistSelection(selection: MachineScopeSelection): void {
  if (typeof window === "undefined" || selection === null) {
    return;
  }

  try {
    window.localStorage.setItem(MACHINE_SCOPE_STORAGE_KEY, selection);
  } catch {
    // A blocked or full localStorage must not prevent switching machines.
  }
}

/** The user's explicit machine choice. `null` means use the default machine. */
const selectedMachineScopeAtom = Atom.make<MachineScopeSelection>(readPersistedSelection()).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-selected-machine-scope"),
);

/**
 * The machine every scoped surface filters by. `null` is deliberately "no
 * filter" rather than "nothing": it is what the cross-machine overview selects,
 * and what an unresolved catalog leaves behind.
 */
export const machineEnvironmentIdAtom = Atom.make((get): EnvironmentId | null => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const selected = get(selectedMachineScopeAtom);
  return resolveMachineEnvironmentId({ entries: catalog.entries, selected });
}).pipe(Atom.withLabel("web-machine-environment-id"));

/** Whether the cross-machine overview is the active scope. */
export const machineOverviewActiveAtom = Atom.make((get): boolean => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const selected = get(selectedMachineScopeAtom);
  return isMachineOverviewSelected({ entries: catalog.entries, selected });
}).pipe(Atom.withLabel("web-machine-overview-active"));

export function selectMachineEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.set(selectedMachineScopeAtom, environmentId);
  persistSelection(environmentId);
}

export function selectMachineOverview(): void {
  appAtomRegistry.set(selectedMachineScopeAtom, MACHINE_SCOPE_OVERVIEW);
  persistSelection(MACHINE_SCOPE_OVERVIEW);
}

export {
  isEnvironmentInMachineScope,
  MACHINE_SCOPE_OVERVIEW,
  resolveMachineEnvironmentId,
  type MachineScopeSelection,
};
