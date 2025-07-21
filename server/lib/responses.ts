import { ApiError, ErrorCode } from './errors';

// Types
interface ApiResponse<T = any> {
    status: string;
    data?: T;
    error?: {
        code: ErrorCode;
        message: string;
        details?: Record<string, any>;
        timestamp: string;
    };
}

// Helper functions
export function createSuccessResponse<T>(
    status: string,
    data?: T,
): ApiResponse<T> {
    return { status, data };
}

export function createErrorResponse(error: ApiError): ApiResponse {
    return {
        status: 'error',
        error: {
            code: error.code,
            message: error.message,
            details: error.details,
            timestamp: error.timestamp,
        },
    };
}
