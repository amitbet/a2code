import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { CloudIcon, LayersIcon, MonitorIcon, ServerIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import {
  setMachineEnvironmentId,
  setMachineOverview,
  useEnvironments,
  useMachineEnvironmentId,
  useMachineOverviewActive,
} from "../../state/environments";
import { cn } from "../../lib/utils";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

// Shares the value space with environment ids in the Select; an environment id
// is never this literal.
const OVERVIEW_VALUE = "overview";
const OVERVIEW_LABEL = "Overview";

export function MachineSwitcher({ onBackdrop }: { readonly onBackdrop: boolean }) {
  const { environments } = useEnvironments();
  const machineEnvironmentId = useMachineEnvironmentId();
  const overviewActive = useMachineOverviewActive();
  const navigate = useNavigate();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const draftEnvironmentId = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft"
      ? (store.getDraftSession(routeTarget.draftId)?.environmentId ?? null)
      : null,
  );
  const routeEnvironmentId: EnvironmentId | null =
    routeTarget?.kind === "server"
      ? routeTarget.threadRef.environmentId
      : routeTarget?.kind === "draft"
        ? draftEnvironmentId
        : null;
  const machineItems = useMemo(
    () =>
      environments
        .map((environment) => ({
          environmentId: environment.environmentId,
          label: environment.label,
          isPrimary: environment.entry.target._tag === "PrimaryConnectionTarget",
        }))
        .sort((left, right) => {
          if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
          return left.label.localeCompare(right.label);
        }),
    [environments],
  );
  const activeMachine =
    machineItems.find((machine) => machine.environmentId === machineEnvironmentId) ??
    machineItems[0] ??
    null;

  const handleScopeChange = useCallback(
    (value: string) => {
      if (value === OVERVIEW_VALUE) {
        if (overviewActive) return;
        // The overview contains every machine, so the current route is still in
        // scope — widening the scope never orphans where the user is standing.
        setMachineOverview();
        return;
      }
      const environmentId = value as EnvironmentId;
      if (!overviewActive && environmentId === machineEnvironmentId) return;
      setMachineEnvironmentId(environmentId);
      if (routeEnvironmentId !== null && routeEnvironmentId !== environmentId) {
        void navigate({ to: "/", replace: true });
      }
    },
    [machineEnvironmentId, navigate, overviewActive, routeEnvironmentId],
  );

  if (activeMachine === null) {
    return null;
  }

  // The overview would show exactly one machine's work under an "all machines"
  // label, so it is only offered once there is a second machine to aggregate.
  const overviewAvailable = machineItems.length > 1;

  const MachineIcon = activeMachine.isPrimary ? MonitorIcon : CloudIcon;
  const triggerClassName = cn(
    "ml-auto min-w-0 max-w-44 shrink font-medium",
    onBackdrop ? "text-white/90 hover:text-white" : "text-muted-foreground hover:text-foreground",
  );

  if (!overviewAvailable) {
    return (
      <div
        className={cn(
          "relative z-10 ml-auto inline-flex min-w-0 max-w-44 items-center gap-1 text-xs",
          onBackdrop ? "text-white/80" : "text-muted-foreground/75",
        )}
        data-testid="machine-switcher"
      >
        <MachineIcon className="size-3 shrink-0" />
        <span className="truncate">{activeMachine.label}</span>
      </div>
    );
  }

  return (
    <Select
      modal={false}
      value={overviewActive ? OVERVIEW_VALUE : activeMachine.environmentId}
      onValueChange={(value) => handleScopeChange(value as string)}
      items={[
        { value: OVERVIEW_VALUE, label: OVERVIEW_LABEL },
        ...machineItems.map((machine) => ({
          value: machine.environmentId,
          label: machine.label,
        })),
      ]}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className={triggerClassName}
        aria-label="Active machine"
        data-testid="machine-switcher"
      >
        {overviewActive ? (
          <LayersIcon className="size-3 shrink-0" />
        ) : (
          <ServerIcon className="size-3 shrink-0" />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Scope</SelectGroupLabel>
          <SelectItem value={OVERVIEW_VALUE}>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <LayersIcon className="size-3 shrink-0" />
              <span className="truncate">{OVERVIEW_LABEL}</span>
            </span>
          </SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectGroupLabel>Active machine</SelectGroupLabel>
          {machineItems.map((machine) => {
            const Icon = machine.isPrimary ? MonitorIcon : CloudIcon;
            return (
              <SelectItem key={machine.environmentId} value={machine.environmentId}>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Icon className="size-3 shrink-0" />
                  <span className="truncate">{machine.label}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
}
