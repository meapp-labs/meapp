import axios, { AxiosError, isAxiosError } from 'axios';
import { env } from './env';

export const api = axios.create({
    baseURL: env.EXPO_PUBLIC_API_URL,
    headers: { 'Content-Type': 'application/json' },
    withCredentials: true,
});

export async function getFetcher<T, P = Record<string, any>>(
    url: string,
    params?: P,
): Promise<T> {
    const res = await api.get<T>(url, { params });
    return res.data;
}

export async function postFetcher<TResponse, TRequest>(
    url: string,
    body: TRequest,
): Promise<TResponse> {
    const res = await api.post<TResponse>(url, body);
    return res.data;
}

export function extractErrorMessage(error: unknown): string {
    if (isAxiosError<ApiErrorResponse>(error)) {
        return error.response?.data.message || error.message;
    }
    return 'An unexpected error occurred';
}

export type ApiErrorResponse = {
    message: string;
    code: string;
};

export type ApiError<T = ApiErrorResponse> = AxiosError<T>;
