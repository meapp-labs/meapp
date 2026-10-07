export type Endpoint = `api/${string}` | `ws/${string}` | 'health'

export function endpoint(base: string, path: Endpoint, params?: Record<string, unknown>): string {
  const url = new URL(`${base.replace(/\/+$/, '')}/${path}`)
  if (params) {
    for (const [key, value] of Object.entries(params))
      if (value !== undefined && value !== null) url.searchParams.append(key, String(value))
  }
  return url.toString()
}

/** Compatibility for older callers that supply paths relative to /api. */
export function apiEndpoint(base: string, path: string, params?: Record<string, unknown>): string {
  const clean = path.replace(/^\/+/, '')
  if (clean === 'health') return endpoint(base, 'health', params)
  if (clean.startsWith('ws/')) return endpoint(base, `ws/${clean.slice(3)}`, params)
  return endpoint(base, `api/${clean.startsWith('api/') ? clean.slice(4) : clean}`, params)
}
