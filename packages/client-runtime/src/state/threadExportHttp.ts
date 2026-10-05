import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentRawHttpRequest } from "./environmentHttpAuth.ts";

const DEFAULT_THREAD_EXPORT_TIMEOUT_MS = 60_000;

/** Server route serving a thread as a zip of `transcript.md` + `attachments/`. */
export const threadExportPath = (threadId: ThreadId): string =>
  `/api/thread-export/${encodeURIComponent(threadId)}`;

/**
 * Download a thread export (zip bytes) through the environment's prepared
 * credential. A raw fetch is not enough: remote environments authenticate with
 * a Bearer or DPoP credential rather than a browser cookie. The signer and
 * relay authorization are read from context when present, so cookie and bearer
 * connections work without them.
 */
export const fetchEnvironmentThreadExport = Effect.fn(
  "clientRuntime.state.fetchEnvironmentThreadExport",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly timeoutMs?: number;
}) {
  const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
  );
  const client = yield* HttpClient.HttpClient;
  const bytes = yield* executeAuthenticatedEnvironmentRawHttpRequest({
    prepared: input.prepared,
    signer,
    remoteAuthorization,
    method: "GET",
    url: (httpBaseUrl) => environmentEndpointUrl(httpBaseUrl, threadExportPath(input.threadId)),
    timeoutMs: input.timeoutMs ?? DEFAULT_THREAD_EXPORT_TIMEOUT_MS,
    request: ({ requestUrl, headers }) =>
      client.get(requestUrl, { headers }).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.arrayBuffer),
      ),
  });
  return new Uint8Array(bytes);
});

/**
 * Fetch one thread's transcript as Markdown from the environment that owns it.
 * Used to attach a thread on another machine as context, where the agent's
 * `t3_thread_read` cannot reach.
 */
export const fetchEnvironmentThreadTranscript = Effect.fn(
  "clientRuntime.state.fetchEnvironmentThreadTranscript",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly timeoutMs?: number;
}) {
  const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
  );
  const client = yield* HttpClient.HttpClient;
  return yield* executeAuthenticatedEnvironmentRawHttpRequest({
    prepared: input.prepared,
    signer,
    remoteAuthorization,
    method: "GET",
    url: (httpBaseUrl) => {
      // environmentEndpointUrl drops the query, so the format is set afterwards.
      const url = new URL(environmentEndpointUrl(httpBaseUrl, threadExportPath(input.threadId)));
      url.searchParams.set("format", "markdown");
      return url.toString();
    },
    timeoutMs: input.timeoutMs ?? DEFAULT_THREAD_EXPORT_TIMEOUT_MS,
    request: ({ requestUrl, headers }) =>
      client.get(requestUrl, { headers }).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.text),
      ),
  });
});

export type FetchEnvironmentThreadExportError = RemoteEnvironmentRequestError;
