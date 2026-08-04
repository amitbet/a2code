import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { fetchEnvironmentThreadExport } from "./threadExportHttp.ts";

const prepared = (
  httpAuthorization: PreparedConnection["httpAuthorization"],
): PreparedConnection => ({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Environment",
  httpBaseUrl: "https://environment.example.test/",
  socketUrl: "wss://environment.example.test/",
  httpAuthorization,
  target: {} as PreparedConnection["target"],
});

describe("fetchEnvironmentThreadExport", () => {
  it.effect("authenticates bearer downloads", () => {
    const fetch = ((input, init) => {
      expect(String(input)).toBe("https://environment.example.test/api/thread-export/thread-1");
      expect(init?.headers).toEqual(expect.objectContaining({ authorization: "Bearer token" }));
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    }) satisfies typeof globalThis.fetch;

    return fetchEnvironmentThreadExport({
      prepared: prepared({ _tag: "Bearer", token: "token" }),
      threadId: ThreadId.make("thread-1"),
    }).pipe(Effect.provide(remoteHttpClientLayer(fetch)));
  });

  it.effect("includes cookies for primary downloads", () => {
    const fetch = ((_, init) => {
      expect(init?.credentials).toBe("include");
      return Promise.resolve(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));
    }) satisfies typeof globalThis.fetch;

    return fetchEnvironmentThreadExport({
      prepared: prepared(null),
      threadId: ThreadId.make("thread-1"),
    }).pipe(Effect.provide(remoteHttpClientLayer(fetch)));
  });
});
