import type { EnvironmentId } from "@t3tools/contracts";
import type {
  NativeStackHeaderItem,
  NativeStackHeaderItemMenu,
} from "@react-navigation/native-stack";

import type { MachineSwitcherEnvironment } from "../../components/MachineSwitcher";
import type { HomeListFilterMenu } from "../home/home-list-filter-menu";
import { createMachineHeaderItem } from "../layout/machine-header-item";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";

type NativeHeaderMenuItems = NativeStackHeaderItemMenu["menu"]["items"];
type NativeHeaderIcon = NonNullable<Extract<NativeStackHeaderItem, { type: "button" }>["icon"]>;

function sfSymbolIcon(name: string): NativeHeaderIcon {
  return { type: "sfSymbol", name: name as never };
}

function toNativeHeaderMenuItems(items: HomeListFilterMenu["items"]): NativeHeaderMenuItems {
  return items.map((item) =>
    item.type === "action"
      ? {
          type: "action" as const,
          label: item.title,
          description: item.subtitle,
          onPress: item.onPress,
          state: item.state === "on" ? ("on" as const) : undefined,
        }
      : {
          type: "submenu" as const,
          label: item.title,
          items: toNativeHeaderMenuItems(item.items),
        },
  );
}

/**
 * Right-side UINavigationBar items for the sidebar column: the thread list
 * filter/sort menu plus the settings button, sharing one glass capsule —
 * the Messages-style grouped header buttons.
 */
export function createSidebarHeaderItems(input: {
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly environments: ReadonlyArray<MachineSwitcherEnvironment>;
  readonly filterIcon: string;
  readonly filterMenu: HomeListFilterMenu;
  readonly onEnvironmentChange: (environmentId: EnvironmentId) => void;
  readonly onOpenSettings: () => void;
}): NativeStackHeaderItem[] {
  return [
    createMachineHeaderItem({
      activeEnvironmentId: input.activeEnvironmentId,
      environments: input.environments,
      onEnvironmentChange: input.onEnvironmentChange,
    }),
    withNativeGlassHeaderItem({
      type: "menu",
      label: "",
      accessibilityLabel: "Filter threads",
      icon: sfSymbolIcon(input.filterIcon),
      menu: {
        title: input.filterMenu.title,
        items: toNativeHeaderMenuItems(input.filterMenu.items),
      },
    }),
    withNativeGlassHeaderItem({
      type: "button",
      label: "",
      accessibilityLabel: "Open settings",
      icon: sfSymbolIcon("gearshape"),
      onPress: input.onOpenSettings,
    }),
  ];
}
