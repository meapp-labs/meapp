import { apiEndpoint } from './endpoints'
export { endpoint } from './endpoints'
export type ApiRequestInit = RequestInit & { timeoutMs?: number }
import type { ApiError as SharedApiError } from '@meapp/shared'
import { AuthStorage } from './authStorage'
import { env } from './env'

export type ApiErrorResponse = SharedApiError

function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage || typeof rawMessage !== 'string') return 'An error occurred'
  return rawMessage
    .replace(/(?:\/(?:Users|home|app|var|node_modules|src)[\w.-]*)+/gi, '[path]')
    .replace(/[A-Za-z]:\\[\w\\.-]+/g, '[path]')
    .trim()
}

export class ApiHttpError extends Error {
  readonly status: number
  readonly response?: { data: ApiErrorResponse }

  constructor(status: number, data?: unknown, statusText?: string) {
    const errorData =
      typeof data === 'object' && data !== null ? (data as ApiErrorResponse) : undefined
    const rawMessage = errorData?.message || statusText || `Request failed with status ${status}`
    const message = sanitizeErrorMessage(rawMessage)
    super(message)
    this.name = 'ApiHttpError'
    this.status = status
    if (errorData) {
      this.response = { data: errorData }
    }
  }
}

export function isApiHttpError(error: unknown): error is ApiHttpError {
  return error instanceof ApiHttpError
}

export type ApiError<T = ApiErrorResponse> = ApiHttpError & {
  response?: { data: T }
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path)
    if (params)
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.append(key, String(value))
      }
    return url.toString()
  }
  return apiEndpoint(env.EXPO_PUBLIC_API_URL, path, params)
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  init?: ApiRequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  const token = await AuthStorage.getToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const { timeoutMs = 30_000, ...fetchInit } = init ?? {}
  const options: RequestInit = {
    ...fetchInit,
    method,
    headers,
    credentials: 'include',
  }

  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }

  // AbortController is supported by both browsers and the native fetch runtime.
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (init?.signal?.aborted) abort()
  else init?.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  options.signal = controller.signal
  try {
    const response = await fetch(url, options)
    const contentType = response.headers.get('content-type')
    let data: unknown
    if (contentType?.includes('application/json')) {
      try {
        data = await response.json()
      } catch {
        data = null
      }
    } else {
      try {
        const text = await response.text()
        data = text || null
      } catch {
        data = null
      }
    }

    if (!response.ok) {
      throw new ApiHttpError(response.status, data, response.statusText)
    }

    return data as T
  } finally {
    clearTimeout(timer)
    init?.signal?.removeEventListener('abort', abort)
  }
}

export async function getFetcher<T, P = Record<string, unknown>>(
  url: string,
  params?: P,
  init?: ApiRequestInit,
): Promise<T> {
  const targetUrl = buildUrl(url, params as Record<string, unknown> | undefined)
  return request<T>('GET', targetUrl, undefined, init)
}

export async function postFetcher<TResponse, TRequest = unknown>(
  url: string,
  body?: TRequest,
  init?: ApiRequestInit,
): Promise<TResponse> {
  return request<TResponse>('POST', buildUrl(url), body, init)
}

export async function patchFetcher<TResponse, TRequest = unknown>(
  url: string,
  body?: TRequest,
  init?: ApiRequestInit,
): Promise<TResponse> {
  return request<TResponse>('PATCH', buildUrl(url), body, init)
}

export async function deleteFetcher<TResponse>(
  url: string,
  init?: ApiRequestInit,
): Promise<TResponse> {
  return request<TResponse>('DELETE', buildUrl(url), undefined, init)
}
