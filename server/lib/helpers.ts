import { ApiError, ErrorCode } from './errors';

export async function handleAsyncOperation<T>(
  operation: () => Promise<T>,
  errorMessage: string,
  errorCode: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(errorCode, errorMessage, 500, {
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}

export function handleSyncOperation<T>(
  operation: () => T,
  errorMessage: string,
  errorCode: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(errorCode, errorMessage, 500, {
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}
