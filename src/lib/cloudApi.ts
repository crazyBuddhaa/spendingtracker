import type { CollectionName, SyncRow } from "./syncFormat.ts";

export type CloudErrorKind = "offline" | "no-api" | "not-configured" | "signed-out" | "server";

export class CloudError extends Error {
  readonly kind: CloudErrorKind;
  constructor(kind: CloudErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface CloudAccount {
  email: string;
  storage: { database: boolean; files: boolean };
  transactions: number;
  statements: number;
}

export interface StoredStatement {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  rowsImported: number;
  uploadedAt: number;
}

export interface StoredBackup {
  id: string;
  size: number;
  transactionCount: number;
  createdAt: number;
}

export interface TransactionPage {
  rows: Array<[SyncRow, 0 | 1, number]>;
  next: string;
  hasMore: boolean;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      // Cloudflare Access answers an expired session with a redirect to its login page.
      redirect: "manual",
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    throw new CloudError("offline", "Can't reach the server. Changes are kept on this device and will sync when you're back online.");
  }
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new CloudError("signed-out", "Your Cloudflare sign-in has expired. Reload the page to sign in again.");
  }
  // A static host (or `vite dev`) answers /api/* with the app's HTML or a plain 404: there is no API here.
  if (!(response.headers.get("Content-Type") ?? "").includes("application/json") && (response.ok || response.status === 404)) {
    throw new CloudError("no-api", "Cloud sync is not available on this site.");
  }
  if (!response.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = await response.json() as typeof body;
    } catch {
      // fall through with an empty body
    }
    if (response.status === 401 || response.status === 403) throw new CloudError("signed-out", body.error ?? "Sign in through Cloudflare Access to sync.");
    if (body.code === "not_configured") throw new CloudError("not-configured", body.error ?? "Cloud storage is not set up yet.");
    throw new CloudError("server", body.error ?? `The server returned an error (${response.status}).`);
  }
  return response;
}

async function callJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return await (await call(path, init)).json() as T;
}

export const cloudApi = {
  me: () => callJson<CloudAccount>("/api/me"),

  transactionsPage: (after: string, limit = 5000) =>
    callJson<TransactionPage>(`/api/transactions?after=${encodeURIComponent(after)}&limit=${limit}`),

  writeTransactions: (upserts: SyncRow[], deletes: string[]) =>
    callJson<{ updatedAt: number }>("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upserts, deletes }),
    }),

  collections: () => callJson<{ collections: Partial<Record<CollectionName, { data: unknown; updatedAt: number }>> }>("/api/collections"),

  saveCollection: (name: CollectionName, data: unknown[]) =>
    callJson<{ updatedAt: number }>(`/api/collections/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }),

  statements: () => callJson<{ statements: StoredStatement[] }>("/api/statements"),

  uploadStatement: (file: File, rowsImported: number) =>
    callJson<{ statement: StoredStatement; duplicate: boolean }>(
      `/api/statements?name=${encodeURIComponent(file.name)}&rows=${rowsImported}`,
      { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } },
    ),

  deleteStatement: (id: string) => callJson<{ deleted: boolean }>(`/api/statements/${id}`, { method: "DELETE" }),

  statementUrl: (id: string) => `/api/statements/${id}`,

  backups: () => callJson<{ backups: StoredBackup[] }>("/api/backups"),

  createCloudBackup: () => callJson<{ backup: StoredBackup }>("/api/backups", { method: "POST" }),

  deleteCloudBackup: (id: string) => callJson<{ deleted: boolean }>(`/api/backups/${id}`, { method: "DELETE" }),

  backupUrl: (id: string) => `/api/backups/${id}`,

  signInUrl: () => "/api/auth/start",
};
