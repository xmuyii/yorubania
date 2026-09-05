import { getAccessToken } from "./auth";

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL;

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await safeError(res)) ?? `GET ${path} failed (${res.status})`);
  return res.json();
}

export async function apiPost(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await safeError(res)) ?? `POST ${path} failed (${res.status})`);
  if (res.status === 204) return null;
  return res.json();
}

export async function apiPatch(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await safeError(res)) ?? `PATCH ${path} failed (${res.status})`);
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { method: "DELETE", headers: await authHeaders() });
  if (!res.ok) throw new Error((await safeError(res)) ?? `DELETE ${path} failed (${res.status})`);
}

/** For binary uploads (vault items, media) — raw bytes, not JSON. */
export async function apiPostBinary(
  path: string,
  bytes: Uint8Array,
  extraHeaders: Record<string, string> = {}
): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: await authHeaders(extraHeaders),
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new Error((await safeError(res)) ?? `POST ${path} failed (${res.status})`);
  return res.json();
}

/** For binary downloads (vault items, media) — returns bytes + response headers. */
export async function apiGetBinary(path: string): Promise<{ bytes: Uint8Array; headers: Headers }> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await safeError(res)) ?? `GET ${path} failed (${res.status})`);
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), headers: res.headers };
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const data = await res.json();
    return data.error ?? null;
  } catch {
    return null;
  }
}
