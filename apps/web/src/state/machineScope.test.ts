import { RelayConnectionTarget, PrimaryConnectionTarget } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { isEnvironmentInMachineScope, resolveMachineEnvironmentId } from "./machineScope";

const LOCAL_ID = EnvironmentId.make("environment-local");
const REMOTE_ID = EnvironmentId.make("environment-remote");

const entries = new Map([
  [
    LOCAL_ID,
    {
      target: new PrimaryConnectionTarget({
        environmentId: LOCAL_ID,
        label: "This device",
        httpBaseUrl: "http://localhost",
        wsBaseUrl: "ws://localhost",
      }),
      profile: Option.none(),
    },
  ],
  [
    REMOTE_ID,
    {
      target: new RelayConnectionTarget({
        environmentId: REMOTE_ID,
        label: "Remote machine",
      }),
      profile: Option.none(),
    },
  ],
]);

describe("machine scope", () => {
  it("rejects an environment outside the selected machine", () => {
    expect(isEnvironmentInMachineScope(LOCAL_ID, REMOTE_ID)).toBe(false);
    expect(isEnvironmentInMachineScope(REMOTE_ID, REMOTE_ID)).toBe(true);
  });

  it("allows the catalog to resolve before enforcing a machine", () => {
    expect(isEnvironmentInMachineScope(REMOTE_ID, null)).toBe(true);
  });

  it("keeps a selected registered machine active", () => {
    expect(resolveMachineEnvironmentId({ entries, selected: REMOTE_ID })).toBe(REMOTE_ID);
  });

  it("falls back to the local machine when the selection is unavailable", () => {
    expect(
      resolveMachineEnvironmentId({
        entries,
        selected: EnvironmentId.make("environment-missing"),
      }),
    ).toBe(LOCAL_ID);
  });

  it("uses the first registered machine when no local machine exists", () => {
    const remoteOnlyEntries = new Map([[REMOTE_ID, entries.get(REMOTE_ID)!]]);
    expect(resolveMachineEnvironmentId({ entries: remoteOnlyEntries, selected: null })).toBe(
      REMOTE_ID,
    );
  });
});
