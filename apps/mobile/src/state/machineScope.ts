import type { EnvironmentId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import {
  isEnvironmentInMachineScope,
  resolveMachineEnvironmentId,
} from "@t3tools/client-runtime/state/machine-scope";

import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "./atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "./preferences";

/** The user's explicit machine choice. The catalog resolves the fallback. */
const selectedMachineEnvironmentIdAtom = Atom.make<EnvironmentId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile-selected-machine-environment-id"),
);

export const machineEnvironmentIdAtom = Atom.make((get): EnvironmentId | null => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  const preferences = get(mobilePreferencesAtom);
  const persisted =
    AsyncResult.isSuccess(preferences) && preferences.value.machineEnvironmentId
      ? (preferences.value.machineEnvironmentId as EnvironmentId)
      : null;
  const selected = get(selectedMachineEnvironmentIdAtom) ?? persisted;

  return resolveMachineEnvironmentId({ entries: catalog.entries, selected });
}).pipe(Atom.withLabel("mobile-machine-environment-id"));

export function useMachineEnvironmentId(): EnvironmentId | null {
  return useAtomValue(machineEnvironmentIdAtom);
}

export function selectMachineEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.set(selectedMachineEnvironmentIdAtom, environmentId);
  appAtomRegistry.set(updateMobilePreferencesAtom, {
    machineEnvironmentId: String(environmentId),
  });
}

export { isEnvironmentInMachineScope, resolveMachineEnvironmentId };
