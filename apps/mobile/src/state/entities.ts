import { useAtomValue } from "@effect/atom-react";

import { appAtomRegistry } from "./atom-registry";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { withoutNestedSideQuestions } from "@t3tools/client-runtime/state/side-questions";
import type {
  EnvironmentId,
  ScopedProjectRef,
  ScopedThreadRef,
  ServerConfig,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { environmentProjects } from "./projects";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";
import { environmentThreadShells } from "./threads";
import { useMachineEnvironmentId } from "./machineScope";

const EMPTY_PROJECT_ATOM = Atom.make<EnvironmentProject | null>(null).pipe(
  Atom.withLabel("mobile-project:empty"),
);
const EMPTY_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("mobile-thread-shell:empty"),
);
const EMPTY_SIDE_QUESTION_SHELLS_ATOM = Atom.make<ReadonlyArray<EnvironmentThreadShell>>([]).pipe(
  Atom.withLabel("mobile-side-question-shells:empty"),
);
const EMPTY_SERVER_CONFIG_ATOM = Atom.make<ServerConfig | null>(null).pipe(
  Atom.withLabel("mobile-server-config:empty"),
);

/** Resolves when the project event reaches the live client store. */
export function waitForProject(
  ref: ScopedProjectRef,
  timeoutMs = 10_000,
): Promise<EnvironmentProject | null> {
  const atom = environmentProjects.projectAtom(ref);
  const current = appAtomRegistry.get(atom);
  if (current !== null) return Promise.resolve(current);
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      resolve(null);
    }, timeoutMs);
    const finish = (project: EnvironmentProject | null) => {
      if (project === null) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(project);
    };
    unsubscribe = appAtomRegistry.subscribe(atom, finish);
    finish(appAtomRegistry.get(atom));
  });
}

export function useProjects(): ReadonlyArray<EnvironmentProject> {
  return useAtomValue(environmentProjects.projectsAtom);
}

export function useThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(environmentThreadShells.threadShellsAtom);
}

function filterEnvironmentEntities<A>(
  entities: ReadonlyArray<A>,
  environmentId: EnvironmentId | null,
  getEnvironmentId: (entity: A) => EnvironmentId,
): ReadonlyArray<A> {
  return environmentId === null
    ? entities
    : entities.filter((entity) => getEnvironmentId(entity) === environmentId);
}

export function useMachineProjects(): ReadonlyArray<EnvironmentProject> {
  const projects = useProjects();
  const machineEnvironmentId = useMachineEnvironmentId();
  return useMemo(
    () =>
      filterEnvironmentEntities(projects, machineEnvironmentId, (project) => project.environmentId),
    [machineEnvironmentId, projects],
  );
}

export function useMachineThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  const threads = useThreadShells();
  const machineEnvironmentId = useMachineEnvironmentId();
  return useMemo(
    () =>
      filterEnvironmentEntities(threads, machineEnvironmentId, (thread) => thread.environmentId),
    [machineEnvironmentId, threads],
  );
}

/**
 * Machine thread shells for thread lists: `/btw` side questions are dropped
 * when their parent is in the list, since they open from the parent thread.
 */
export function useMachineListThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  const threads = useMachineThreadShells();
  return useMemo(() => withoutNestedSideQuestions(threads), [threads]);
}

export function useProject(ref: ScopedProjectRef | null): EnvironmentProject | null {
  return useAtomValue(ref === null ? EMPTY_PROJECT_ATOM : environmentProjects.projectAtom(ref));
}

export function useThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.threadShellAtom(ref),
  );
}

/** Unarchived `/btw` side questions asked from `ref`, oldest first. */
export function useSideQuestionShells(
  ref: ScopedThreadRef | null,
): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(
    ref === null
      ? EMPTY_SIDE_QUESTION_SHELLS_ATOM
      : environmentThreadShells.sideQuestionShellsAtom(ref),
  );
}

export function useEnvironmentServerConfig(
  environmentId: EnvironmentId | null,
): ServerConfig | null {
  return useAtomValue(
    environmentId === null
      ? EMPTY_SERVER_CONFIG_ATOM
      : serverEnvironment.configValueAtom(environmentId),
  );
}

export function useServerConfigs(): ReadonlyMap<EnvironmentId, ServerConfig> {
  return useAtomValue(environmentServerConfigsAtom);
}
