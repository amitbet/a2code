// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import type { ProviderRateLimitSnapshot, ProviderRateLimitWindow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { invalidateMacOSKeychainPassword, readMacOSKeychainPassword } from "./MacOSKeychain.ts";

const DEFAULT_API_ENDPOINT = "https://api2.cursor.sh";
const CURRENT_PERIOD_USAGE_PATH = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const KEYCHAIN_ACCOUNT = "cursor-user";
const KEYCHAIN_SERVICE = "cursor-access-token";
const KEYCHAIN_API_KEY_SERVICE = "cursor-api-key";

// Protobuf JSON represents int64 values as strings, while the int32/double
// fields in this response are normally numbers. Accept both so a server-side
// change in the generated JSON codec does not make the meter disappear.
const JsonNumber = Schema.Union([Schema.Number, Schema.String, Schema.Null]);

const PlanUsageSchema = Schema.Struct({
  totalSpend: Schema.optional(JsonNumber),
  includedSpend: Schema.optional(JsonNumber),
  bonusSpend: Schema.optional(JsonNumber),
  remaining: Schema.optional(JsonNumber),
  limit: Schema.optional(JsonNumber),
  autoSpend: Schema.optional(JsonNumber),
  apiSpend: Schema.optional(JsonNumber),
  autoLimit: Schema.optional(JsonNumber),
  apiLimit: Schema.optional(JsonNumber),
  autoPercentUsed: Schema.optional(JsonNumber),
  apiPercentUsed: Schema.optional(JsonNumber),
  totalPercentUsed: Schema.optional(JsonNumber),
});

const SpendLimitUsageSchema = Schema.Struct({
  pooledLimit: Schema.optional(JsonNumber),
  pooledUsed: Schema.optional(JsonNumber),
  pooledRemaining: Schema.optional(JsonNumber),
  individualLimit: Schema.optional(JsonNumber),
  individualUsed: Schema.optional(JsonNumber),
  individualRemaining: Schema.optional(JsonNumber),
  overallLimit: Schema.optional(JsonNumber),
  overallUsed: Schema.optional(JsonNumber),
  overallRemaining: Schema.optional(JsonNumber),
});

export const CursorCurrentPeriodUsageResponseSchema = Schema.Struct({
  billingCycleStart: Schema.optional(JsonNumber),
  billingCycleEnd: Schema.optional(JsonNumber),
  planUsage: Schema.optional(Schema.NullOr(PlanUsageSchema)),
  spendLimitUsage: Schema.optional(Schema.NullOr(SpendLimitUsageSchema)),
});

export type CursorCurrentPeriodUsageResponse = typeof CursorCurrentPeriodUsageResponseSchema.Type;

export interface CursorUsageApiOptions {
  readonly apiEndpoint?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

function envValue(environment: NodeJS.ProcessEnv | undefined, name: string): string | undefined {
  const value = environment?.[name] ?? NodeProcess.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function explicitEnvValue(
  environment: NodeJS.ProcessEnv | undefined,
  name: string,
): { readonly present: boolean; readonly value: string | null } {
  const source = environment ?? NodeProcess.env;
  if (!Object.prototype.hasOwnProperty.call(source, name)) {
    return { present: false, value: null };
  }
  const value = source[name]?.trim();
  return { present: true, value: value || null };
}

function resolveApiEndpoint(options: CursorUsageApiOptions): string {
  return (
    options.apiEndpoint?.trim() ||
    envValue(options.environment, "CURSOR_API_ENDPOINT") ||
    envValue(options.environment, "CURSOR_API_BASE_URL") ||
    DEFAULT_API_ENDPOINT
  ).replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findAccessToken(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["accessToken", "access_token"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  for (const key of ["auth", "credentials", "user"]) {
    const nested = findAccessToken(value[key]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function parseCursorAuth(raw: string): string | null {
  try {
    return findAccessToken(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function cursorAuthFilePath(environment: NodeJS.ProcessEnv | undefined): string {
  const configuredDirectory = envValue(environment, "CURSOR_CONFIG_DIR");
  if (configuredDirectory) {
    return NodePath.join(configuredDirectory, "auth.json");
  }

  const home = envValue(environment, "HOME") || NodeOS.homedir();
  return NodePath.join(home, ".cursor", "auth.json");
}

/**
 * Cursor Agent stores the macOS access token in the user's Keychain. The file
 * fallback is retained for non-macOS installs and older CLI configurations.
 * Neither path is logged or written by this integration.
 */
type CursorCredentialSource = "environment" | "keychain" | "file";

interface CursorCredential {
  readonly value: string;
  readonly source: CursorCredentialSource;
}

const readCursorAccessToken = (
  environment: NodeJS.ProcessEnv | undefined,
): Effect.Effect<CursorCredential | null> =>
  Effect.gen(function* () {
    const environmentToken = explicitEnvValue(environment, "CURSOR_ACCESS_TOKEN");
    if (environmentToken.present) {
      return environmentToken.value
        ? { value: environmentToken.value, source: "environment" as const }
        : null;
    }

    const fromKeychain = yield* readMacOSKeychainPassword({
      account: KEYCHAIN_ACCOUNT,
      service: KEYCHAIN_SERVICE,
    });
    if (fromKeychain) {
      return { value: fromKeychain, source: "keychain" };
    }

    const fromFile = yield* Effect.tryPromise(() =>
      NodeFSP.readFile(cursorAuthFilePath(environment), "utf8"),
    ).pipe(
      Effect.map(parseCursorAuth),
      Effect.orElseSucceed(() => null),
    );
    return fromFile ? { value: fromFile, source: "file" } : null;
  });

const readCursorApiKey = (
  environment: NodeJS.ProcessEnv | undefined,
): Effect.Effect<CursorCredential | null> =>
  Effect.gen(function* () {
    const environmentApiKey = explicitEnvValue(environment, "CURSOR_API_KEY");
    if (environmentApiKey.present) {
      return environmentApiKey.value
        ? { value: environmentApiKey.value, source: "environment" as const }
        : null;
    }
    if (NodeProcess.platform !== "darwin") {
      return null;
    }
    const fromKeychain = yield* readMacOSKeychainPassword({
      account: KEYCHAIN_ACCOUNT,
      service: KEYCHAIN_API_KEY_SERVICE,
    });
    return fromKeychain ? { value: fromKeychain, source: "keychain" as const } : null;
  });

const ApiKeyExchangeResponseSchema = Schema.Struct({
  accessToken: Schema.String,
});

const exchangeApiKey = (
  apiEndpoint: string,
  apiKey: string,
): Effect.Effect<string | null, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(`${apiEndpoint}/auth/exchange_user_api_key`).pipe(
      HttpClientRequest.bearerToken(apiKey),
      HttpClientRequest.acceptJson,
    );
    return yield* httpClient.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ApiKeyExchangeResponseSchema)),
      Effect.map((response) => response.accessToken),
      Effect.orElseSucceed(() => null),
    );
  });

const fetchCurrentPeriodUsage = (
  apiEndpoint: string,
  accessToken: string,
): Effect.Effect<CursorCurrentPeriodUsageResponse | null, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(`${apiEndpoint}${CURRENT_PERIOD_USAGE_PATH}`).pipe(
      HttpClientRequest.bearerToken(accessToken),
      HttpClientRequest.setHeader("x-cursor-client-type", "cli"),
      HttpClientRequest.setHeader("x-cursor-client-version", "cli-t3code"),
      HttpClientRequest.setHeader("x-ghost-mode", "true"),
      HttpClientRequest.bodyJsonUnsafe({}),
      HttpClientRequest.acceptJson,
    );

    return yield* httpClient.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(CursorCurrentPeriodUsageResponseSchema)),
      Effect.orElseSucceed(() => null),
    );
  });

function numberValue(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function percentage(
  explicit: string | number | null | undefined,
  used: string | number | null | undefined,
  limit: string | number | null | undefined,
): number | undefined {
  const explicitValue = numberValue(explicit);
  if (explicitValue !== undefined) {
    return Math.max(0, Math.min(100, explicitValue));
  }

  const usedValue = numberValue(used);
  const limitValue = numberValue(limit);
  if (usedValue === undefined || limitValue === undefined || limitValue <= 0) {
    return undefined;
  }
  return Math.max(0, Math.min(100, (usedValue / limitValue) * 100));
}

function epochSeconds(value: string | number | null | undefined): number | undefined {
  const numeric = numberValue(value);
  if (numeric === undefined || numeric <= 0) {
    return undefined;
  }
  // Connect's JSON mapping uses milliseconds for this API's int64 timestamps.
  return Math.round(numeric > 10_000_000_000 ? numeric / 1_000 : numeric);
}

function formatCents(value: number): string {
  return `$${(value / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function spendDetail(
  used: string | number | null | undefined,
  limit: string | number | null | undefined,
): string | undefined {
  const usedValue = numberValue(used);
  const limitValue = numberValue(limit);
  if (usedValue === undefined || limitValue === undefined || limitValue <= 0) {
    return undefined;
  }
  return `${formatCents(usedValue)} / ${formatCents(limitValue)}`;
}

function usageWindow(input: {
  readonly kind: ProviderRateLimitWindow["kind"];
  readonly label: string;
  readonly explicitPercent: string | number | null | undefined;
  readonly used: string | number | null | undefined;
  readonly limit: string | number | null | undefined;
  readonly resetsAt: number | undefined;
}): ProviderRateLimitWindow | null {
  const usedPercent = percentage(input.explicitPercent, input.used, input.limit);
  if (usedPercent === undefined) {
    return null;
  }
  const detail = spendDetail(input.used, input.limit);
  return {
    kind: input.kind,
    label: input.label,
    usedPercent,
    ...(input.resetsAt !== undefined ? { resetsAt: input.resetsAt } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
}

function spendLimitWindow(
  usage: CursorCurrentPeriodUsageResponse["spendLimitUsage"],
  resetsAt: number | undefined,
): ProviderRateLimitWindow | null {
  if (!usage) {
    return null;
  }

  const used = usage.individualUsed ?? usage.pooledUsed ?? usage.overallUsed;
  const limit = usage.individualLimit ?? usage.pooledLimit ?? usage.overallLimit;
  return usageWindow({
    kind: "spend",
    label: "On-demand spend",
    explicitPercent: undefined,
    used,
    limit,
    resetsAt,
  });
}

/** Map Cursor's internal dashboard response into the shared quota snapshot. */
export function normalizeCursorUsage(
  response: CursorCurrentPeriodUsageResponse,
): ProviderRateLimitSnapshot | null {
  const resetsAt = epochSeconds(response.billingCycleEnd);
  const plan = response.planUsage;
  const cursorModelsWindow = usageWindow({
    kind: "other",
    label: "Cursor models",
    explicitPercent: plan?.autoPercentUsed,
    used: plan?.autoSpend,
    limit: plan?.autoLimit,
    resetsAt,
  });
  const apiModelsWindow = usageWindow({
    kind: "other",
    label: "API models",
    explicitPercent: plan?.apiPercentUsed,
    used: plan?.apiSpend,
    limit: plan?.apiLimit,
    resetsAt,
  });
  const totalUsageWindow =
    plan && cursorModelsWindow === null && apiModelsWindow === null
      ? usageWindow({
          kind: "other",
          label: "Total usage",
          explicitPercent: plan.totalPercentUsed,
          used: plan.totalSpend,
          limit: plan.limit,
          resetsAt,
        })
      : null;
  const windows = [
    cursorModelsWindow,
    apiModelsWindow,
    totalUsageWindow,
    spendLimitWindow(response.spendLimitUsage, resetsAt),
  ].filter((window): window is ProviderRateLimitWindow => window !== null);

  return windows.length > 0 ? { windows } : null;
}

/**
 * Fetch Cursor's current billing-period usage, or null when the CLI is not
 * authenticated, the token has expired, the account has no usage data, or the
 * undocumented dashboard RPC is unavailable.
 */
export const fetchCursorUsageSnapshot = (
  options: CursorUsageApiOptions = {},
): Effect.Effect<ProviderRateLimitSnapshot | null> =>
  Effect.gen(function* () {
    const apiEndpoint = resolveApiEndpoint(options);
    const configuredAccessToken = explicitEnvValue(options.environment, "CURSOR_ACCESS_TOKEN");
    const configuredApiKey = explicitEnvValue(options.environment, "CURSOR_API_KEY");
    // Per-instance credentials must win over the global macOS Keychain. This
    // prevents two Cursor provider instances configured for different accounts
    // from accidentally using the same Keychain access token.
    const directCredential = configuredAccessToken.present
      ? configuredAccessToken.value
        ? { value: configuredAccessToken.value, source: "environment" as const }
        : null
      : configuredApiKey.present
        ? null
        : yield* readCursorAccessToken(options.environment);
    const apiKeyCredential = configuredApiKey.present
      ? configuredApiKey.value
        ? { value: configuredApiKey.value, source: "environment" as const }
        : null
      : configuredAccessToken.present
        ? null
        : yield* readCursorApiKey(options.environment);

    if (directCredential) {
      const response = yield* fetchCurrentPeriodUsage(apiEndpoint, directCredential.value);
      if (response) {
        return normalizeCursorUsage(response);
      }
      if (directCredential.source === "keychain") {
        invalidateMacOSKeychainPassword({
          account: KEYCHAIN_ACCOUNT,
          service: KEYCHAIN_SERVICE,
        });
      }
    }

    if (!apiKeyCredential) {
      return null;
    }
    const exchangedToken = yield* exchangeApiKey(apiEndpoint, apiKeyCredential.value);
    if (!exchangedToken || exchangedToken === directCredential?.value) {
      if (apiKeyCredential.source === "keychain") {
        invalidateMacOSKeychainPassword({
          account: KEYCHAIN_ACCOUNT,
          service: KEYCHAIN_API_KEY_SERVICE,
        });
      }
      return null;
    }
    const response = yield* fetchCurrentPeriodUsage(apiEndpoint, exchangedToken);
    if (!response && apiKeyCredential.source === "keychain") {
      invalidateMacOSKeychainPassword({
        account: KEYCHAIN_ACCOUNT,
        service: KEYCHAIN_API_KEY_SERVICE,
      });
    }
    return response ? normalizeCursorUsage(response) : null;
  }).pipe(Effect.provide(FetchHttpClient.layer));
