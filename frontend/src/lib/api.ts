/**
 * Cliente HTTP. El access token vive sólo en memoria; el refresh token es una cookie
 * httpOnly gestionada por el backend. Ante un 401 se intenta un refresco (una sola vez,
 * compartido entre peticiones concurrentes) y se repite la petición.
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function getAccessToken() {
  return accessToken;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) return null;
        const data = await r.json();
        return data.access_token as string;
      })
      .catch(() => null)
      .then((t) => {
        accessToken = t;
        refreshing = null;
        return t;
      });
  }
  return refreshing;
}

type Opts = Omit<RequestInit, "body"> & { body?: unknown; raw?: boolean };

async function errorMessage(r: Response): Promise<string> {
  try {
    const data = await r.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail[0]?.msg ?? "Error";
  } catch {
    /* sin cuerpo JSON */
  }
  return r.status >= 500 ? "Error del servidor. Inténtalo de nuevo." : `Error ${r.status}`;
}

export async function api<T = unknown>(path: string, opts: Opts = {}, retry = true): Promise<T> {
  const headers = new Headers(opts.headers);
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.body);
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const r = await fetch(`/api/v1${path}`, { ...opts, headers, body, credentials: "same-origin" });
  if (r.status === 401 && retry && !path.startsWith("/auth/login")) {
    const t = await refreshAccessToken();
    if (t) return api<T>(path, opts, false);
    onUnauthorized?.();
  }
  if (!r.ok) throw new ApiError(r.status, await errorMessage(r));
  if (opts.raw) return r as unknown as T;
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

/** Construye una query string ignorando valores vacíos. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== false) s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : "";
}

export async function downloadFile(path: string, filename: string) {
  const r = await api<Response>(path, { raw: true });
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
