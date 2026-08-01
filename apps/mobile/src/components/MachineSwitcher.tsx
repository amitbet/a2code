import type { EnvironmentId } from "@t3tools/contracts";
import type {
  NativeStackHeaderItem,
  NativeStackHeaderItemMenu,
} from "@react-navigation/native-stack";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { ControlPillMenu } from "./ControlPill";
import { SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";
import { withNativeGlassHeaderItem } from "../features/layout/native-glass-header-items";
import { useThemeColor } from "../lib/useThemeColor";

export interface MachineSwitcherEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

export function createMachineHeaderItem(input: {
  readonly environments: ReadonlyArray<MachineSwitcherEnvironment>;
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId) => void;
}): NativeStackHeaderItem {
  const items: NativeStackHeaderItemMenu["menu"]["items"] = input.environments.map(
    (environment) => ({
      type: "action" as const,
      label: environment.label,
      state: checkedMenuState(environment.environmentId === input.activeEnvironmentId),
      onPress: () => input.onEnvironmentChange(environment.environmentId),
    }),
  );

  return withNativeGlassHeaderItem({
    type: "menu",
    label: "",
    accessibilityLabel: "Active environment",
    icon: { type: "sfSymbol", name: "server.rack" } as const,
    menu: {
      title: "Active environment",
      items,
    },
  });
}

export function MachineSwitcher(props: {
  readonly environments: ReadonlyArray<MachineSwitcherEnvironment>;
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId) => void;
  readonly grouped?: boolean;
}) {
  const iconColor = useThemeColor("--color-icon");
  const activeEnvironment =
    props.environments.find(
      (environment) => environment.environmentId === props.activeEnvironmentId,
    ) ??
    props.environments[0] ??
    null;
  const actions = useMemo(
    () =>
      props.environments.map((environment) => ({
        id: `machine:${environment.environmentId}`,
        title: environment.label,
        state: checkedMenuState(environment.environmentId === activeEnvironment?.environmentId),
      })),
    [activeEnvironment?.environmentId, props.environments],
  );

  if (activeEnvironment === null) {
    return null;
  }

  const button = (
    <Pressable
      accessibilityLabel={`Active environment: ${activeEnvironment.label}`}
      accessibilityRole="button"
      className={
        props.grouped
          ? "h-11 max-w-[190px] flex-row items-center gap-1.5 rounded-full px-2.5"
          : "h-11 max-w-[220px] flex-row items-center gap-1.5 rounded-full bg-subtle px-3"
      }
    >
      <SymbolView name="server.rack" size={16} tintColor={iconColor} type="monochrome" />
      <Text className="min-w-0 flex-1 text-xs font-t3-bold text-foreground" numberOfLines={1}>
        {activeEnvironment.label}
      </Text>
      {props.environments.length > 1 ? (
        <SymbolView name="chevron.down" size={13} tintColor={iconColor} type="monochrome" />
      ) : null}
    </Pressable>
  );

  return props.environments.length > 1 ? (
    <ControlPillMenu
      actions={actions}
      title="Active environment"
      onPressAction={(event) => {
        const environmentId = event.nativeEvent.event.slice("machine:".length) as EnvironmentId;
        if (props.environments.some((environment) => environment.environmentId === environmentId)) {
          props.onEnvironmentChange(environmentId);
        }
      }}
    >
      {button}
    </ControlPillMenu>
  ) : (
    <View>{button}</View>
  );
}
