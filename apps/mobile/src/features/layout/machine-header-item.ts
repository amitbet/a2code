import type { EnvironmentId } from "@t3tools/contracts";
import type {
  NativeStackHeaderItem,
  NativeStackHeaderItemMenu,
} from "@react-navigation/native-stack";

import type { MachineSwitcherEnvironment } from "../../components/MachineSwitcher";
import { withNativeGlassHeaderItem } from "./native-glass-header-items";

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

/** Native header menu twin of `MachineSwitcher`, for screens with a native stack header. */
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
