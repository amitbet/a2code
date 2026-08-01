import type { EnvironmentId } from "@t3tools/contracts";
import type { ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
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

/**
 * Returns whether an environment may be used under the current machine
 * selection. A null machine id means the connection catalog has not resolved
 * a machine yet, so callers should wait for normal availability checks.
 */
export function isEnvironmentInMachineScope(
  environmentId: EnvironmentId | null | undefined,
  machineEnvironmentId: EnvironmentId | null,
): boolean {
  return machineEnvironmentId === null || environmentId === machineEnvironmentId;
}

/**
 * Resolves the machine shown by the app. A saved choice wins while its
 * connection remains registered; otherwise fall back to the local primary
 * environment, then the first registered environment.
 */
export function resolveMachineEnvironmentId(input: {
  entries: ReadonlyMap<EnvironmentId, Pick<ConnectionCatalogEntry, "target">>;
  selected: EnvironmentId | null;
}): EnvironmentId | null {
  if (input.selected !== null && input.entries.has(input.selected)) {
    return input.selected;
  }

  for (const [environmentId, entry] of input.entries) {
    if (entry.target._tag === "PrimaryConnectionTarget") {
      return environmentId;
    }
  }

  return input.entries.keys().next().value ?? null;
}

export const machineEnvironmentIdAtom = Atom.make((get): EnvironmentId | null => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const selected = get(selectedMachineEnvironmentIdAtom);
  return resolveMachineEnvironmentId({ entries: catalog.entries, selected });
}).pipe(Atom.withLabel("web-machine-environment-id"));

export function selectMachineEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.set(selectedMachineEnvironmentIdAtom, environmentId);
  persistEnvironmentId(environmentId);
}
