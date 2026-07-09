// ATLAS API — lib/logger.ts
// Structured logger. Phase 1: console JSON. Phase 2: plug into your existing
// VERA/NEXUS log pipeline (the spec says "match project conventions").

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel: LogLevel =
  (process.env.ATLAS_API_LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[configuredLevel];
}

interface LogContext {
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, ctx: LogContext = {}) {
  if (!shouldLog(level)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...ctx,
  };
  // Bun / Node: console.log is line-buffered, JSON-friendly.
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  stream(JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
  // Domain-specific helpers for ATLAS Constitution audit trail.
  collector: (name: string, ctx?: LogContext) =>
    emit("info", `[collector:${name}]`, { collector: name, ...ctx }),
  layer: (name: string, ctx?: LogContext) =>
    emit("info", `[layer:${name}]`, { layer: name, ...ctx }),
  constitution: (rule: string, msg: string, ctx?: LogContext) =>
    emit("warn", `[constitution:rule-${rule}] ${msg}`, { constitutionRule: rule, ...ctx }),
};
