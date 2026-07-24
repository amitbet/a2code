import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { getLatestThreadForProject } from "../lib/threadSort";
import { newProjectId } from "../lib/utils";
import { resolveDefaultProviderModelSelection } from "../providerInstances";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { primaryServerProvidersAtom } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useClientSettings } from "./useSettings";

export interface AddProjectFromPathInput {
  readonly environmentId: EnvironmentId;
  readonly rawCwd: string;
  readonly platform: string;
  readonly currentProjectCwd: string | null;
}

/**
 * Add the directory at the given path as a project in the target environment
 * and navigate to a thread in it, reopening the existing project when the
 * path already backs one. Returns true once navigation happened so callers
 * can close transient UI (e.g. the command palette).
 */
export function useAddProjectFromPath(): (input: AddProjectFromPathInput) => Promise<boolean> {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const createProject = useAtomCommand(projectEnvironment.create, {
    reportFailure: false,
  });

  return useCallback(
    async (input: AddProjectFromPathInput) => {
      const rawCwd = input.rawCwd;

      if (isUnsupportedWindowsProjectPath(rawCwd.trim(), input.platform)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to add project",
            description: "Windows-style paths are only supported on Windows.",
          }),
        );
        return false;
      }

      if (isExplicitRelativeProjectPath(rawCwd.trim()) && !input.currentProjectCwd) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to add project",
            description: "Relative paths require an active project.",
          }),
        );
        return false;
      }

      const cwd = resolveProjectPathForDispatch(rawCwd, input.currentProjectCwd);
      if (cwd.length === 0) return false;

      const existing = findProjectByPath(
        projects.filter((project) => project.environmentId === input.environmentId),
        cwd,
      );
      if (existing) {
        const latestThread = getLatestThreadForProject(
          threads.filter((thread) => thread.environmentId === existing.environmentId),
          existing.id,
          sidebarThreadSortOrder,
        );
        if (latestThread) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(latestThread.environmentId, latestThread.id),
            ),
          });
        } else {
          const navigationResult = await settlePromise(() =>
            handleNewThread(scopeProjectRef(existing.environmentId, existing.id)),
          );
          if (navigationResult._tag === "Failure") {
            const error = squashAtomCommandFailure(navigationResult);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to open project",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
            return false;
          }
        }
        return true;
      }

      const projectId = newProjectId();
      const targetEnvironmentProviders =
        environments.find((environment) => environment.environmentId === input.environmentId)
          ?.serverConfig?.providers ??
        (input.environmentId === primaryEnvironmentId ? providers : []);
      const createResult = await createProject({
        environmentId: input.environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(cwd),
          workspaceRoot: cwd,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: resolveDefaultProviderModelSelection(
            targetEnvironmentProviders,
            null,
          ),
        },
      });
      if (createResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(createResult)) {
          const error = squashAtomCommandFailure(createResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to add project",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return false;
      }

      const navigationResult = await settlePromise(() =>
        handleNewThread(scopeProjectRef(input.environmentId, projectId)),
      );
      if (navigationResult._tag === "Failure") {
        const error = squashAtomCommandFailure(navigationResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to add project",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
        return false;
      }
      return true;
    },
    [
      createProject,
      environments,
      handleNewThread,
      navigate,
      primaryEnvironmentId,
      projects,
      providers,
      sidebarThreadSortOrder,
      threads,
    ],
  );
}
