import type { EnvironmentId } from "@t3tools/contracts";
import {
  isEnvironmentInMachineScope,
  resolveMachineEnvironmentId,
} from "@t3tools/client-runtime/state/machine-scope";
import { Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../rpc/atomRegistry";

const MACHINE_SCOPE_STORAGE_KEY = "t3code:machine-scope:v1";

function readPersistedEnvironmentId(): EnvironmentId | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(MACHINE_SCOPE_STORAGE_KEY);
    return value && value.length > 0 ? (value as EnvironmentId) : null;
  } catch {
    return null;
  }
}

function persistEnvironmentId(environmentId: EnvironmentId): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(MACHINE_SCOPE_STORAGE_KEY, environmentId);
  } catch {
    // A blocked or full localStorage must not prevent switching machines.
  }
}

/** The user's explicit machine choice. `null` means use the default machine. */
const selectedMachineEnvironmentIdAtom = Atom.make<EnvironmentId | null>(
  readPersistedEnvironmentId(),
).pipe(Atom.keepAlive, Atom.withLabel("web-selected-machine-environment-id"));

export const machineEnvironmentIdAtom = Atom.make((get): EnvironmentId | null => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const selected = get(selectedMachineEnvironmentIdAtom);
  return resolveMachineEnvironmentId({ entries: catalog.entries, selected });
}).pipe(Atom.withLabel("web-machine-environment-id"));

export function selectMachineEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.set(selectedMachineEnvironmentIdAtom, environmentId);
  persistEnvironmentId(environmentId);
}

export { isEnvironmentInMachineScope, resolveMachineEnvironmentId };
