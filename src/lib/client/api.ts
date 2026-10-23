"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.code ?? "error", data?.error ?? `Request failed (${res.status}).`);
  return data as T;
}

export const fetcher = <T = unknown>(url: string) => fetch(url, { credentials: "same-origin" }).then((r) => handle<T>(r));

export function post<T = unknown>(url: string, body: unknown, method: "POST" | "PUT" | "PATCH" = "POST"): Promise<T> {
  return fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export function del<T = unknown>(url: string): Promise<T> {
  return fetch(url, { method: "DELETE", credentials: "same-origin" }).then((r) => handle<T>(r));
}
