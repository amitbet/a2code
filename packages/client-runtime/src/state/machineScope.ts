import type { EnvironmentId } from "@t3tools/contracts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";

/**
 * The stored machine choice. A concrete environment id scopes the client to one
 * machine; `MACHINE_SCOPE_OVERVIEW` asks for the cross-machine overview; `null`
 * means "never chosen", which resolves to the default machine.
 */
export const MACHINE_SCOPE_OVERVIEW = "overview";
export type MachineScopeSelection = EnvironmentId | typeof MACHINE_SCOPE_OVERVIEW | null;

/**
 * Returns whether an environment belongs to the currently selected machine.
 * A null selection means either the cross-machine overview or a catalog that
 * has not resolved a machine yet; both want every environment to pass, so
 * callers fall through to their normal availability checks.
 */
export function isEnvironmentInMachineScope(
  environmentId: EnvironmentId | null | undefined,
  machineEnvironmentId: EnvironmentId | null,
): boolean {
  return machineEnvironmentId === null || environmentId === machineEnvironmentId;
}

/**
 * Resolves the machine shown by the client. A saved choice wins while its
 * connection remains registered; otherwise prefer the local primary
 * environment, then the first registered environment.
 */
export function resolveMachineEnvironmentId(input: {
  readonly entries: ReadonlyMap<EnvironmentId, Pick<ConnectionCatalogEntry, "target">>;
  readonly selected: MachineScopeSelection;
}): EnvironmentId | null {
  if (isMachineOverviewSelected(input)) {
    return null;
  }
  if (
    input.selected !== null &&
    input.selected !== MACHINE_SCOPE_OVERVIEW &&
    input.entries.has(input.selected)
  ) {
    return input.selected;
  }

  for (const [environmentId, entry] of input.entries) {
    if (entry.target._tag === "PrimaryConnectionTarget") {
      return environmentId;
    }
  }

  return input.entries.keys().next().value ?? null;
}

/**
 * Whether the cross-machine overview is the active scope. The overview only
 * makes sense with more than one machine registered — with a single machine it
 * would show exactly that machine's work under a misleading label — so a stored
 * overview choice degrades to the default machine until a second one appears.
 */
export function isMachineOverviewSelected(input: {
  readonly entries: ReadonlyMap<EnvironmentId, Pick<ConnectionCatalogEntry, "target">>;
  readonly selected: MachineScopeSelection;
}): boolean {
  return input.selected === MACHINE_SCOPE_OVERVIEW && input.entries.size > 1;
}
