import type { EnvironmentId } from "@t3tools/contracts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";

/**
 * Returns whether an environment belongs to the currently selected machine.
 * A null selection means the connection catalog has not resolved a machine
 * yet, so callers should defer to their normal availability checks.
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
  readonly selected: EnvironmentId | null;
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
