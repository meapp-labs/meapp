export const ErrorCode = {
  // Authentication
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',

  // Rate limiting
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  RATE_LIMITED: 'RATE_LIMITED',

  // Users
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // Data
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  DUPLICATE_ITEM: 'DUPLICATE_ITEM',
  DATA_CORRUPTION: 'DATA_CORRUPTION',

  // System
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/** Body shape expected by the client's `ApiErrorResponse` ({ message, code }). */
export type ErrorBody = {
  message: string
  code: ErrorCode
  details?: Record<string, unknown>
}

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly details: Record<string, unknown> | undefined

  constructor(
    code: ErrorCode,
    message: string,
    statusCode = 500,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }

  toBody(): ErrorBody {
    return this.details
      ? { message: this.message, code: this.code, details: this.details }
      : { message: this.message, code: this.code }
  }
}

export const createAuthError = (message = 'Authentication failed') =>
  new ApiError(ErrorCode.UNAUTHORIZED, message, 401)

export const createAuthenticationRequiredError = () =>
  new ApiError(ErrorCode.AUTHENTICATION_REQUIRED, 'Authentication required', 401)

export const createValidationError = (message: string, details?: Record<string, unknown>) =>
  new ApiError(ErrorCode.VALIDATION_ERROR, message, 400, details)

export const createRateLimitError = (message: string, details?: Record<string, unknown>) =>
  new ApiError(ErrorCode.TOO_MANY_ATTEMPTS, message, 429, details)

export const createUserExistsError = (username: string) =>
  new ApiError(ErrorCode.USER_ALREADY_EXISTS, 'User already exists', 409, { username })

export const createUserNotFoundError = (username: string) =>
  new ApiError(ErrorCode.USER_NOT_FOUND, 'User not found', 404, { username })

export const createDuplicateItemError = (message = 'Item already exists') =>
  new ApiError(ErrorCode.DUPLICATE_ITEM, message, 409)

export const createNotFoundError = (resource: string, details?: Record<string, unknown>) =>
  new ApiError(ErrorCode.ITEM_NOT_FOUND, `${resource} not found`, 404, details)

export const createDatabaseError = (operation: string, originalError?: Error) =>
  new ApiError(ErrorCode.DATABASE_ERROR, `Database ${operation} failed`, 500, {
    operation,
    originalError: originalError?.message,
  })

/**
 * Converts any thrown value into a status code and an `ApiError`-shaped body.
 * Kept separate from the handler so routes can reuse it if needed.
 */
export const toErrorResponse = (error: unknown): { status: number; body: ErrorBody } => {
  if (error instanceof ApiError) {
    return { status: error.statusCode, body: error.toBody() }
  }

  return {
    status: 500,
    body: {
      message: 'An unexpected error occurred',
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      details: { originalError: error instanceof Error ? error.message : String(error) },
    },
  }
}

/** Wraps an async operation so unexpected failures surface as DATABASE_ERROR/DATABASE operations. */
export const handleAsyncOperation = async <T>(
  operation: () => Promise<T>,
  errorMessage: string,
  code: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(code, errorMessage, 500, {
      originalError: error instanceof Error ? error.message : String(error),
    })
  }
}
