import type { EnvironmentId } from "@t3tools/contracts";

import type { EnvironmentPresentation } from "../../state/environments";

export interface MachineItem {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPrimary: boolean;
}

/** Machines in picker order: the primary (local) machine first, then by label. */
export function machineItemsFromEnvironments(
  environments: ReadonlyArray<EnvironmentPresentation>,
): ReadonlyArray<MachineItem> {
  return environments
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      isPrimary: environment.entry.target._tag === "PrimaryConnectionTarget",
    }))
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
      return left.label.localeCompare(right.label);
    });
}

/** The machine after `current` in picker order, wrapping; the first one from Overview. */
export function nextMachineEnvironmentId(
  machines: ReadonlyArray<MachineItem>,
  current: EnvironmentId | null,
): EnvironmentId | null {
  if (machines.length === 0) return null;
  const index = machines.findIndex((machine) => machine.environmentId === current);
  return machines[(index + 1) % machines.length]!.environmentId;
}
