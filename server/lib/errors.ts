import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { createErrorResponse } from './responses';

// Error Types
export enum ErrorCode {
    // Authentication errors
    UNAUTHORIZED = 'UNAUTHORIZED',
    INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
    AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
    SESSION_EXPIRED = 'SESSION_EXPIRED',

    // Rate limiting errors
    TOO_MANY_ATTEMPTS = 'TOO_MANY_ATTEMPTS',
    RATE_LIMITED = 'RATE_LIMITED',

    // User management errors
    USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS',
    USER_NOT_FOUND = 'USER_NOT_FOUND',
    INVALID_USER_DATA = 'INVALID_USER_DATA',

    // Validation errors
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
    INVALID_INPUT_FORMAT = 'INVALID_INPUT_FORMAT',

    // Data errors
    ITEM_NOT_FOUND = 'ITEM_NOT_FOUND',
    DUPLICATE_ITEM = 'DUPLICATE_ITEM',
    DATA_CORRUPTION = 'DATA_CORRUPTION',

    // System errors
    INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    REDIS_CONNECTION_ERROR = 'REDIS_CONNECTION_ERROR',
    SESSION_ERROR = 'SESSION_ERROR',

    // Operation errors
    OPERATION_FAILED = 'OPERATION_FAILED',
    CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION',
    RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',
}

export class ApiError extends Error {
    public readonly code: ErrorCode;
    public readonly statusCode: number;
    public readonly details?: Record<string, any>;
    public readonly timestamp: string;

    constructor(
        code: ErrorCode,
        message: string,
        statusCode: number = 500,
        details?: Record<string, any>,
    ) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.timestamp = new Date().toISOString();

        // Maintains proper stack trace for where our error was thrown
        Error.captureStackTrace(this, ApiError);
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                statusCode: this.statusCode,
                details: this.details,
                timestamp: this.timestamp,
            },
        };
    }
}

// Specific error classes
export class AuthenticationError extends ApiError {
    constructor(
        message: string = 'Authentication failed',
        details?: Record<string, any>,
    ) {
        super(ErrorCode.UNAUTHORIZED, message, 401, details);
    }
}

export class ValidationError extends ApiError {
    constructor(
        message: string = 'Validation failed',
        details?: Record<string, any>,
    ) {
        super(ErrorCode.VALIDATION_ERROR, message, 400, details);
    }
}

export class RateLimitError extends ApiError {
    constructor(
        message: string = 'Too many requests',
        details?: Record<string, any>,
    ) {
        super(ErrorCode.TOO_MANY_ATTEMPTS, message, 429, details);
    }
}

export class UserError extends ApiError {
    constructor(
        code: ErrorCode,
        message: string,
        statusCode: number = 400,
        details?: Record<string, any>,
    ) {
        super(code, message, statusCode, details);
    }
}

export class DatabaseError extends ApiError {
    constructor(
        message: string = 'Database operation failed',
        details?: Record<string, any>,
    ) {
        super(ErrorCode.DATABASE_ERROR, message, 500, details);
    }
}

export class NotFoundError extends ApiError {
    constructor(resource: string = 'Resource', details?: Record<string, any>) {
        super(ErrorCode.ITEM_NOT_FOUND, `${resource} not found`, 404, details);
    }
}

export class SessionError extends ApiError {
    constructor(
        message: string = 'Session operation failed',
        details?: Record<string, any>,
    ) {
        super(ErrorCode.SESSION_ERROR, message, 500, details);
    }
}

// Error factory functions
export const createAuthError = (
    message?: string,
    details?: Record<string, any>,
) => new AuthenticationError(message, details);

export const createValidationError = (
    message?: string,
    details?: Record<string, any>,
) => new ValidationError(message, details);

export const createRateLimitError = (
    message?: string,
    details?: Record<string, any>,
) => new RateLimitError(message, details);

export const createUserExistsError = (username: string) =>
    new UserError(ErrorCode.USER_ALREADY_EXISTS, 'User already exists', 409, {
        username,
    });

export const createUserNotFoundError = (username: string) =>
    new UserError(ErrorCode.USER_NOT_FOUND, 'User not found', 404, {
        username,
    });

export const createDatabaseError = (operation: string, originalError?: Error) =>
    new DatabaseError(`Database ${operation} failed`, {
        operation,
        originalError: originalError?.message,
    });

export const createSessionError = (operation: string, originalError?: Error) =>
    new SessionError(`Session ${operation} failed`, {
        operation,
        originalError: originalError?.message,
    });

// Global error handler
export function handleError(error: unknown, server: FastifyInstance): any {
    if (error instanceof ApiError) {
        server.log.error(
            `API Error [${error.code}]:`,
            error.message,
            error.details,
        );
        return createErrorResponse(error);
    }

    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
        const validationError = createValidationError('Invalid input data', {
            validationErrors: error.issues.map((err) => ({
                field: err.path.join('.'),
                message: err.message,
                code: err.code,
            })),
        });
        server.log.error(
            'Validation Error:',
            validationError.message,
            validationError.details,
        );
        return createErrorResponse(validationError);
    }

    // Handle unexpected errors
    const internalError = new ApiError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'An unexpected error occurred',
        500,
        {
            originalError:
                error instanceof Error ? error.message : String(error),
        },
    );

    server.log.error(
        'Unexpected Error:',
        internalError.message,
        internalError.details,
    );
    return createErrorResponse(internalError);
}
