// @effect-diagnostics nodeBuiltinImport:off
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as NodeOS from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ProviderRateLimitSnapshot, ProviderRateLimitWindow } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

// ---------------------------------------------------------------------------
// Claude.ai subscription usage endpoint. This mirrors the request Claude Code
// itself makes to render its Usage screen: GET /api/oauth/usage with the
// claude.ai OAuth bearer token. It returns real, continuous utilization for
// whichever windows the account has (session/weekly for Pro/Max; a spend limit
// for Team/Enterprise) — unlike the SDK `rate_limit_event`, which is coarse and
// only populated near the limit.
// ---------------------------------------------------------------------------

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

const RateLimitField = Schema.NullOr(
  Schema.Struct({
    utilization: Schema.NullOr(Schema.Number),
    resets_at: Schema.NullOr(Schema.String),
  }),
);

const ExtraUsageField = Schema.NullOr(
  Schema.Struct({
    is_enabled: Schema.optional(Schema.Boolean),
    monthly_limit: Schema.optional(Schema.NullOr(Schema.Number)),
    used_credits: Schema.optional(Schema.NullOr(Schema.Number)),
    utilization: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
);

const UtilizationSchema = Schema.Struct({
  five_hour: Schema.optional(RateLimitField),
  seven_day: Schema.optional(RateLimitField),
  seven_day_opus: Schema.optional(RateLimitField),
  seven_day_sonnet: Schema.optional(RateLimitField),
  extra_usage: Schema.optional(ExtraUsageField),
});
type Utilization = typeof UtilizationSchema.Type;

const execFileAsync = promisify(execFile);

interface StoredOAuth {
  readonly accessToken: string;
  readonly expiresAt: number | null;
}

function parseStoredOAuth(raw: string): StoredOAuth | null {
  try {
    const parsed = JSON.parse(raw) as { claudeAiOauth?: Record<string, unknown> };
    const oauth = parsed.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== "string" || oauth.accessToken.length === 0) {
      return null;
    }
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the claude.ai OAuth access token the same way Claude Code does:
 * env override → credentials file under the Claude config dir → macOS keychain.
 * Returns null when no usable (non-expired) token is found.
 */
const readClaudeOAuthToken = (homePath: string | undefined): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    if (envToken) {
      return envToken;
    }

    const trimmedHome = homePath?.trim();
    const resolvedHome =
      trimmedHome && trimmedHome.length > 0
        ? trimmedHome.startsWith("~")
          ? join(NodeOS.homedir(), trimmedHome.slice(1))
          : trimmedHome
        : NodeOS.homedir();
    const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(resolvedHome, ".claude");

    const fromFile = yield* Effect.tryPromise(() =>
      readFile(join(configDir, ".credentials.json"), "utf-8"),
    ).pipe(
      Effect.map(parseStoredOAuth),
      Effect.catch(() => Effect.succeed(null)),
    );

    const stored =
      fromFile ??
      (process.platform === "darwin"
        ? yield* Effect.tryPromise(() =>
            execFileAsync("security", [
              "find-generic-password",
              "-a",
              NodeOS.userInfo().username,
              "-w",
              "-s",
              KEYCHAIN_SERVICE,
            ]),
          ).pipe(
            Effect.map((result) => parseStoredOAuth(result.stdout)),
            Effect.catch(() => Effect.succeed(null)),
          )
        : null);

    if (!stored) {
      return null;
    }
    // Skip expired tokens (epoch ms) — the SDK/Claude Code refreshes them
    // out of band; calling with an expired token would just 401.
    const nowMs = yield* Clock.currentTimeMillis;
    if (stored.expiresAt !== null && stored.expiresAt <= nowMs) {
      return null;
    }
    return stored.accessToken;
  });

const fetchUtilization = (
  token: string,
): Effect.Effect<Utilization | null, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(USAGE_URL).pipe(
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeader("anthropic-beta", OAUTH_BETA_HEADER),
      HttpClientRequest.acceptJson,
    );
    return yield* httpClient.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(UtilizationSchema)),
      Effect.catch(() => Effect.succeed(null)),
    );
  });

function isoToEpochSeconds(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : Math.round(ms / 1000);
}

function rateLimitWindow(
  kind: ProviderRateLimitWindow["kind"],
  label: string,
  field: { utilization: number | null; resets_at: string | null } | null | undefined,
): ProviderRateLimitWindow | null {
  if (!field || field.utilization === null) {
    return null;
  }
  const resetsAt = isoToEpochSeconds(field.resets_at);
  return {
    kind,
    label,
    usedPercent: Math.max(0, Math.min(100, field.utilization)),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function spendWindow(extra: Utilization["extra_usage"]): ProviderRateLimitWindow | null {
  if (!extra || extra.is_enabled === false) {
    return null;
  }
  const utilization = typeof extra.utilization === "number" ? extra.utilization : null;
  if (utilization === null) {
    return null;
  }
  const detail =
    typeof extra.used_credits === "number" && typeof extra.monthly_limit === "number"
      ? `${formatDollars(extra.used_credits)} / ${formatDollars(extra.monthly_limit)}`
      : undefined;
  return {
    kind: "spend",
    label: "Spend",
    usedPercent: Math.max(0, Math.min(100, utilization)),
    ...(detail !== undefined ? { detail } : {}),
  };
}

/** Map the Claude usage response into our cross-provider snapshot. */
export function normalizeClaudeUtilization(
  utilization: Utilization,
): ProviderRateLimitSnapshot | null {
  const windows = [
    rateLimitWindow("five_hour", "Session (5h)", utilization.five_hour),
    rateLimitWindow("weekly", "Weekly", utilization.seven_day),
    rateLimitWindow("weekly", "Weekly · Opus", utilization.seven_day_opus),
    rateLimitWindow("weekly", "Weekly · Sonnet", utilization.seven_day_sonnet),
    spendWindow(utilization.extra_usage),
  ].filter((window): window is ProviderRateLimitWindow => window !== null);
  if (windows.length === 0) {
    return null;
  }
  return { windows };
}

/**
 * Fetch the live Claude usage snapshot, or null if unavailable (no token,
 * expired, non-subscriber, network error, or nothing to show).
 */
export const fetchClaudeUsageSnapshot = (
  homePath: string | undefined,
): Effect.Effect<ProviderRateLimitSnapshot | null> =>
  Effect.gen(function* () {
    const token = yield* readClaudeOAuthToken(homePath);
    if (!token) {
      return null;
    }
    const utilization = yield* fetchUtilization(token);
    if (!utilization) {
      return null;
    }
    return normalizeClaudeUtilization(utilization);
  }).pipe(Effect.provide(FetchHttpClient.layer));
