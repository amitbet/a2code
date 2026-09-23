import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { memo } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";

function isSideQuestionRunning(thread: EnvironmentThreadShell): boolean {
  return thread.session?.status === "running" || thread.session?.status === "starting";
}

/**
 * The `/btw` side questions asked from a thread, as a row of chips above its
 * composer. Tapping a chip opens that side question's thread. Renders nothing
 * when the thread has none.
 */
export const SideQuestionChips = memo(function SideQuestionChips(props: {
  readonly sideQuestions: ReadonlyArray<EnvironmentThreadShell>;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  if (props.sideQuestions.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-4 pb-2"
    >
      {props.sideQuestions.map((thread) => {
        const running = isSideQuestionRunning(thread);
        return (
          <Pressable
            key={thread.id}
            accessibilityRole="button"
            accessibilityLabel={`Open side question ${thread.title}${running ? ", working" : ""}`}
            onPress={() => props.onOpen(thread)}
            className="max-w-[220px] flex-row items-center gap-1.5 rounded-full border border-border bg-card-alt px-3 py-1.5 active:opacity-70"
          >
            {/* Static dot: a spinner here would repaint every frame. */}
            {running ? <View className="h-1.5 w-1.5 rounded-full bg-sky-500" /> : null}
            <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
              btw
            </Text>
            <Text className="shrink font-t3-medium text-xs text-foreground" numberOfLines={1}>
              {thread.title}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});
