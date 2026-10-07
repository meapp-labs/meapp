type Fields = Record<string, unknown>

function write(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  const { err, ...context } = fields
  const error = err instanceof Error ? { name: err.name, message: err.message } : err
  console[level](
    JSON.stringify({
      ...context,
      ts: new Date().toISOString(),
      level,
      event,
      ...(error ? { err: error } : {}),
    }),
  )
}

export const logger = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
}
