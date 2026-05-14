// Structured logger for DeliveryOps.
//
// Outputs JSON-lines in production (Vercel/Cloud) so log aggregators can
// parse them, and pretty-prints in development for human readability.
//
// Usage:
//   import { logger } from "@/lib/logger";
//   const log = logger("sync/monday");
//   log.info("Sync started", { customers: 41 });
//   log.error("Sync failed", { board: "Projects", error: err.message });

type Level = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: Level;
  service: string;
  msg: string;
  [key: string]: unknown;
}

const IS_PROD = process.env.NODE_ENV === "production";
const IS_TEST = process.env.NODE_ENV === "test";

function emit(entry: LogEntry): void {
  if (IS_TEST) return; // suppress in test runner unless explicitly enabled

  if (IS_PROD) {
    // JSON-lines — Vercel / CloudWatch / Datadog can parse these
    process.stdout.write(JSON.stringify(entry) + "\n");
  } else {
    const { ts, level, service, msg, ...rest } = entry;
    const COLORS: Record<Level, string> = {
      debug: "\x1b[37m",
      info:  "\x1b[36m",
      warn:  "\x1b[33m",
      error: "\x1b[31m",
    };
    const RESET = "\x1b[0m";
    const color = COLORS[level];
    const prefix = `${color}[${level.toUpperCase().padEnd(5)}]${RESET} ${service}`;
    const extra = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
    // eslint-disable-next-line no-console
    console.log(`${ts.slice(11, 23)} ${prefix} — ${msg}${extra}`);
  }
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(extra: Record<string, unknown>): Logger;
}

export function logger(service: string, baseCtx: Record<string, unknown> = {}): Logger {
  function log(level: Level, msg: string, ctx: Record<string, unknown> = {}): void {
    emit({ ts: new Date().toISOString(), level, service, msg, ...baseCtx, ...ctx });
  }
  return {
    debug: (msg, ctx) => log("debug", msg, ctx),
    info:  (msg, ctx) => log("info",  msg, ctx),
    warn:  (msg, ctx) => log("warn",  msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),
    child: (extra) => logger(service, { ...baseCtx, ...extra }),
  };
}

// Convenience: create a child logger from an existing error, adding the
// stack and message so callers don't have to repeat the boilerplate.
export function errorCtx(err: unknown): Record<string, string> {
  if (err instanceof Error) {
    return { error: err.message, stack: err.stack?.split("\n")[1]?.trim() ?? "" };
  }
  return { error: String(err) };
}
