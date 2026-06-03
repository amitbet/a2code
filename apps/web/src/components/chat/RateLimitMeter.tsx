import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { type RateLimitSnapshot, formatRateLimitReset } from "~/lib/rateLimits";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function formatPercent(value: number): string {
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

function shortLabel(label: string): string {
  if (label === "5-hour") return "5h";
  if (label === "Weekly") return "Wk";
  if (label.startsWith("Weekly")) return "Wk";
  return label;
}

function barToneClass(usedPercent: number): string {
  if (usedPercent >= 90) {
    return "bg-rose-400/80";
  }
  if (usedPercent >= 75) {
    return "bg-amber-400/80";
  }
  return "bg-muted-foreground/60";
}

function MiniBar(props: { usedPercent: number }) {
  const width = Math.max(0, Math.min(100, props.usedPercent));
  return (
    <span className="relative inline-block h-1.5 w-10 overflow-hidden rounded-full bg-muted/70">
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out",
          barToneClass(props.usedPercent),
        )}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

export function RateLimitMeter(props: { snapshot: RateLimitSnapshot }) {
  const { snapshot } = props;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const rows = snapshot.windows;
  if (rows.length === 0) {
    return null;
  }

  const peak = Math.max(...rows.map((row) => row.usedPercent));

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="group inline-flex items-center gap-1 rounded-full px-1 transition-opacity hover:opacity-85"
            aria-label={`Quota usage, peak ${formatPercent(peak)}`}
          >
            {rows.map((row) => (
              <span key={row.label} className="inline-flex items-center gap-1">
                <span className="text-[9px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
                  {shortLabel(row.label)}
                </span>
                <MiniBar usedPercent={row.usedPercent} />
              </span>
            ))}
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
        <div className="space-y-2 leading-tight">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Quota usage
            </span>
            {snapshot.planType ? (
              <span className="text-[11px] text-muted-foreground/70 capitalize">
                {snapshot.planType}
              </span>
            ) : null}
          </div>
          {rows.map((row) => {
            const reset = formatRateLimitReset(row.resetsAt, nowMs);
            return (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between gap-6 text-xs">
                  <span className="font-medium text-foreground">{row.label}</span>
                  <span className="text-foreground">{formatPercent(row.usedPercent)}</span>
                </div>
                <div className="h-1.5 w-44 overflow-hidden rounded-full bg-muted/70">
                  <div
                    className={cn("h-full rounded-full", barToneClass(row.usedPercent))}
                    style={{ width: `${Math.max(0, Math.min(100, row.usedPercent))}%` }}
                  />
                </div>
                {reset ? <div className="text-[11px] text-muted-foreground/70">{reset}</div> : null}
              </div>
            );
          })}
          {snapshot.status === "rejected" ? (
            <div className="text-[11px] text-rose-400">Rate limit reached.</div>
          ) : snapshot.status === "allowed_warning" ? (
            <div className="text-[11px] text-amber-400">Approaching limit.</div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
