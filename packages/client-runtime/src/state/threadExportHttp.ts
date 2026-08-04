import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { executeEnvironmentHttpRequest, type RemoteEnvironmentRequestError } from "../rpc/http.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";

const DEFAULT_THREAD_EXPORT_TIMEOUT_MS = 30_000;

/**
 * Download a thread export using the same authenticated HTTP path as the
 * environment snapshot loaders. Raw fetches are not sufficient here because
 * remote environments use a prepared Bearer or DPoP credential rather than a
 * browser cookie.
 */
export const fetchEnvironmentThreadExport = Effect.fn(
  "clientRuntime.state.fetchEnvironmentThreadExport",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly timeoutMs?: number;
}) {
  const requestUrl = environmentEndpointUrl(
    input.prepared.httpBaseUrl,
    `/api/thread-export/${encodeURIComponent(input.threadId)}`,
  );
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const headers = yield* buildEnvironmentAuthHeaders(
    input.prepared.httpAuthorization,
    "GET",
    requestUrl,
    signer,
  );
  const client = yield* HttpClient.HttpClient;

  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    input.timeoutMs ?? DEFAULT_THREAD_EXPORT_TIMEOUT_MS,
    withEnvironmentCredentials(
      input.prepared.httpAuthorization,
      client.get(requestUrl, { headers }).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((res) => res.arrayBuffer),
      ),
    ),
  );
});

export type FetchEnvironmentThreadExportError = RemoteEnvironmentRequestError;
