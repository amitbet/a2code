import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isEnvironmentInMachineScope, resolveMachineEnvironmentId } from "./machineScope.ts";

function entry(tag: "PrimaryConnectionTarget" | "BearerConnectionTarget") {
  return { target: { _tag: tag } } as never;
}

describe("machine environment scope", () => {
  it("keeps a registered explicit selection ahead of the primary fallback", () => {
    const primary = EnvironmentId.make("primary");
    const remote = EnvironmentId.make("remote");
    const entries = new Map([
      [primary, entry("PrimaryConnectionTarget")],
      [remote, entry("BearerConnectionTarget")],
    ]);

    expect(resolveMachineEnvironmentId({ entries, selected: remote })).toBe(remote);
    expect(resolveMachineEnvironmentId({ entries, selected: EnvironmentId.make("missing") })).toBe(
      primary,
    );
  });

  it("falls back to the first environment when no primary is registered", () => {
    const first = EnvironmentId.make("first");
    const second = EnvironmentId.make("second");
    const entries = new Map([
      [first, entry("BearerConnectionTarget")],
      [second, entry("BearerConnectionTarget")],
    ]);

    expect(resolveMachineEnvironmentId({ entries, selected: null })).toBe(first);
  });

  it("treats a null machine as unresolved rather than filtering everything", () => {
    const environment = EnvironmentId.make("environment");

    expect(isEnvironmentInMachineScope(environment, null)).toBe(true);
    expect(isEnvironmentInMachineScope(environment, EnvironmentId.make("other"))).toBe(false);
    expect(isEnvironmentInMachineScope(environment, environment)).toBe(true);
  });
});
