type LogContext = Record<string, unknown> | unknown;

function write(level: 'info' | 'warn' | 'error', message: string, ...context: LogContext[]) {
  const extra = context.length > 0 ? context : [];
  console[level](`[cruzible-api] ${message}`, ...extra);
}

export const logger = {
  info(message: string, ...context: LogContext[]) {
    write('info', message, ...context);
  },
  warn(message: string, ...context: LogContext[]) {
    write('warn', message, ...context);
  },
  error(message: string, ...context: LogContext[]) {
    write('error', message, ...context);
  },
};
