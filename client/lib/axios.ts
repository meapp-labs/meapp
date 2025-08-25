import { env } from "@/env";
import axios, { AxiosError } from "axios";

export const api = axios.create({
  baseURL: env.API_URL,
  headers: { "Content-Type": "application/json" },
  withCredentials: true, // ✅ cookies, auth, etc.
});

export async function getFetcher<T, P = Record<string, any>>(url: string, params?: P): Promise<T> {
  const res = await api.get<T>(url, { params });
  return res.data;
}

export async function postFetcher<T, B = unknown>(url: string, body: B): Promise<T> {
  const res = await api.post<T>(url, body);
  return res.data;
}

export type ApiError<T = any> = AxiosError<T>;