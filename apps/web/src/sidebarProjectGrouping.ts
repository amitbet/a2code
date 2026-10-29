import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import {
  buildProjectGroups,
  derivePhysicalProjectKey,
  type ProjectGroupingSettings,
} from "./logicalProject";
import { resolveScratchProjectScopeKey } from "@t3tools/client-runtime/state/project-grouping";
import type { Project } from "./types";

export type EnvironmentPresence = "local-only" | "remote-only" | "mixed";

export interface SidebarProjectGroupMember extends Project {
  physicalProjectKey: string;
  environmentLabel: string | null;
}

export interface SidebarProjectSnapshot extends Project {
  projectKey: string;
  displayName: string;
  groupedProjectCount: number;
  environmentPresence: EnvironmentPresence;
  allRemoteMembersAreDesktopLocal: boolean;
  allRemoteMembersAreWsl: boolean;
  memberProjects: readonly SidebarProjectGroupMember[];
  memberProjectRefs: readonly ScopedProjectRef[];
  remoteEnvironmentLabels: readonly string[];
}

export function projectGroupsSpanEnvironments(
  groups: ReadonlyArray<Pick<SidebarProjectSnapshot, "memberProjects">>,
): boolean {
  const environmentIds = new Set<EnvironmentId>();
  for (const group of groups) {
    for (const member of group.memberProjects) {
      environmentIds.add(member.environmentId);
      if (environmentIds.size > 1) return true;
    }
  }
  return false;
}

export interface SidebarProjectPickerEntry {
  group: SidebarProjectSnapshot;
  targetProject: SidebarProjectGroupMember;
  isPreferred: boolean;
}

export function getSidebarProjectSettingsKey(
  group: SidebarProjectSnapshot,
  settings: ProjectGroupingSettings,
  projects: ReadonlyArray<Project>,
  projectRef?: ScopedProjectRef,
): string {
  if (!group.isScratch) return group.projectKey;
  const project =
    group.memberProjects.find(
      (member) =>
        member.environmentId === projectRef?.environmentId && member.id === projectRef.projectId,
    ) ??
    group.memberProjects.find((member) => member.environmentId === projectRef?.environmentId) ??
    group;
  return (
    buildPhysicalToLogicalProjectKeyMap({ projects, settings, primaryEnvironmentId: null }).get(
      derivePhysicalProjectKey(project),
    ) ?? group.projectKey
  );
}

export function resolveSidebarProjectScopeKey(input: {
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly key: string | null;
  readonly settings?: ProjectGroupingSettings;
  readonly canClearMissingScope?: boolean;
}): string | null {
  if (input.key === null) return null;
  const group =
    input.groups.find((candidate) => candidate.projectKey === input.key) ??
    input.groups.find(
      (candidate) =>
        candidate.isScratch &&
        resolveScratchProjectScopeKey(input.key, candidate.memberProjects, input.settings) ===
          candidate.projectKey,
    );
  return group?.projectKey ?? (input.canClearMissingScope ? null : input.key);
}

export function buildPhysicalToLogicalProjectKeyMap(input: {
  projects: ReadonlyArray<Project>;
  settings: ProjectGroupingSettings;
  primaryEnvironmentId: EnvironmentId | null;
}): Map<string, string> {
  const mapping = new Map<string, string>();
  const groups = buildProjectGroups({
    projects: input.projects,
    settings: input.settings,
    preferredEnvironmentId: input.primaryEnvironmentId,
  });
  for (const group of groups) {
    for (const member of group.members) {
      mapping.set(member.physicalProjectKey, group.key);
    }
  }
  return mapping;
}

export function buildSidebarProjectSnapshots(input: {
  projects: ReadonlyArray<Project>;
  settings: ProjectGroupingSettings;
  groupScratchProjects?: boolean;
  primaryEnvironmentId: EnvironmentId | null;
  resolveEnvironmentLabel: (environmentId: EnvironmentId) => string | null;
  isDesktopLocalEnvironment?: (environmentId: EnvironmentId) => boolean;
  isWslEnvironment?: (environmentId: EnvironmentId) => boolean;
}): SidebarProjectSnapshot[] {
  return buildProjectGroups({
    projects: input.projects,
    groupScratchProjects: input.groupScratchProjects ?? false,
    settings: input.settings,
    preferredEnvironmentId: input.primaryEnvironmentId,
  }).map((group): SidebarProjectSnapshot => {
    const members = group.members.map(
      ({ physicalProjectKey, project }): SidebarProjectGroupMember => ({
        ...project,
        physicalProjectKey,
        environmentLabel: input.resolveEnvironmentLabel(project.environmentId),
      }),
    );
    const representative =
      members.find(
        (member) =>
          member.environmentId === group.representative.environmentId &&
          member.id === group.representative.id,
      ) ?? members[0]!;

    const hasLocal =
      input.primaryEnvironmentId !== null &&
      members.some((member) => member.environmentId === input.primaryEnvironmentId);
    const hasRemote =
      input.primaryEnvironmentId !== null
        ? members.some((member) => member.environmentId !== input.primaryEnvironmentId)
        : false;
    const remoteMembers = members.filter(
      (member) =>
        input.primaryEnvironmentId !== null && member.environmentId !== input.primaryEnvironmentId,
    );
    const remoteEnvironmentLabels = remoteMembers
      .flatMap((member) => (member.environmentLabel ? [member.environmentLabel] : []))
      .filter((label, index, labels) => labels.indexOf(label) === index);
    const isDesktopLocal = input.isDesktopLocalEnvironment ?? (() => false);
    const isWsl = input.isWslEnvironment ?? (() => false);
    const allRemoteMembersAreDesktopLocal =
      remoteMembers.length > 0 &&
      remoteMembers.every((member) => isDesktopLocal(member.environmentId));
    const allRemoteMembersAreWsl =
      remoteMembers.length > 0 && remoteMembers.every((member) => isWsl(member.environmentId));

    return {
      ...representative,
      projectKey: group.key,
      displayName: group.label,
      groupedProjectCount: members.length,
      environmentPresence:
        hasLocal && hasRemote ? "mixed" : hasRemote ? "remote-only" : "local-only",
      allRemoteMembersAreDesktopLocal,
      allRemoteMembersAreWsl,
      memberProjects: members,
      memberProjectRefs: group.memberProjectRefs,
      remoteEnvironmentLabels,
    };
  });
}

/**
 * Splits cross-machine groups into one snapshot per machine, keeping the groups' order. Pickers
 * that start work use this: a machine is chosen for its role, so a project row must name one
 * machine instead of silently landing on the group's representative.
 */
export function splitSidebarProjectSnapshotsByEnvironment(input: {
  groups: ReadonlyArray<SidebarProjectSnapshot>;
  primaryEnvironmentId: EnvironmentId | null;
}): SidebarProjectSnapshot[] {
  return input.groups.flatMap((group) => {
    const environmentIds = [...new Set(group.memberProjects.map((member) => member.environmentId))];
    if (environmentIds.length <= 1) return [group];
    const labelOf = (environmentId: EnvironmentId) =>
      group.memberProjects.find((member) => member.environmentId === environmentId)
        ?.environmentLabel ?? environmentId;
    environmentIds.sort((left, right) => {
      const leftPrimary = left === input.primaryEnvironmentId;
      if (leftPrimary !== (right === input.primaryEnvironmentId)) return leftPrimary ? -1 : 1;
      return labelOf(left).localeCompare(labelOf(right));
    });
    return environmentIds.map((environmentId): SidebarProjectSnapshot => {
      const members = group.memberProjects.filter(
        (member) => member.environmentId === environmentId,
      );
      const representative =
        members.find((member) => member.id === group.id && environmentId === group.environmentId) ??
        members[0]!;
      const isRemote =
        input.primaryEnvironmentId !== null && environmentId !== input.primaryEnvironmentId;
      return {
        ...group,
        ...representative,
        projectKey: group.projectKey,
        displayName: group.displayName,
        groupedProjectCount: members.length,
        environmentPresence: isRemote ? "remote-only" : "local-only",
        allRemoteMembersAreDesktopLocal: isRemote && group.allRemoteMembersAreDesktopLocal,
        allRemoteMembersAreWsl: isRemote && group.allRemoteMembersAreWsl,
        memberProjects: members,
        memberProjectRefs: group.memberProjectRefs.filter(
          (projectRef) => projectRef.environmentId === environmentId,
        ),
        remoteEnvironmentLabels:
          isRemote && representative.environmentLabel ? [representative.environmentLabel] : [],
      };
    });
  });
}

export function buildSidebarProjectPickerEntries(input: {
  groups: ReadonlyArray<SidebarProjectSnapshot>;
  preferredProjectRef: ScopedProjectRef | null;
}) {
  const preferredProjectRef = input.preferredProjectRef;
  const entries = input.groups.flatMap((group): SidebarProjectPickerEntry[] => {
    const isPreferred = preferredProjectRef
      ? group.memberProjectRefs.some(
          (projectRef) =>
            projectRef.environmentId === preferredProjectRef.environmentId &&
            projectRef.projectId === preferredProjectRef.projectId,
        )
      : false;
    const preferredProject = preferredProjectRef
      ? (group.memberProjects.find(
          (project) =>
            project.environmentId === preferredProjectRef.environmentId &&
            project.id === preferredProjectRef.projectId,
        ) ??
        group.memberProjects.find(
          (project) => project.environmentId === preferredProjectRef.environmentId,
        ))
      : null;
    const targetProject =
      preferredProject ??
      group.memberProjects.find(
        (project) => project.environmentId === group.environmentId && project.id === group.id,
      ) ??
      group.memberProjects[0];
    if (!targetProject) return [];

    return [{ group, targetProject, isPreferred }];
  });
  const preferredIndex = entries.findIndex((entry) => entry.isPreferred);
  if (preferredIndex <= 0) return entries;

  return [
    entries[preferredIndex]!,
    ...entries.slice(0, preferredIndex),
    ...entries.slice(preferredIndex + 1),
  ];
}
