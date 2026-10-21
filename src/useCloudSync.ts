import { useCallback, useEffect, useRef, useState } from "react";
import { categoryList, type Transaction } from "./types";
import { cloudApi, CloudError, type CloudAccount, type StoredBackup, type StoredStatement } from "./lib/cloudApi";
import { parseStoredTransactions, serializeTransactions, TRANSACTIONS_STORAGE_KEY } from "./lib/transactionStorage";
import { readValue, writeValue } from "./lib/persistentStore";
import { COLLECTION_NAMES, fromSyncRow, MAX_ROWS_PER_REQUEST, sameRow, toSyncRow, type CollectionName, type SyncRow } from "./lib/syncFormat";

const SYNC_STATE_KEY = "spendwise.sync.v1";
const ACCOUNT_DATA_KEY_PREFIX = "spendwise.account-data.v1.";
const PUSH_DELAY = 1500;
const PULL_INTERVAL = 60_000;
const categories = new Set<string>(categoryList);
const isCategory = (value: string) => categories.has(value);

export type SyncMode = "checking" | "local" | "cloud";
export type SyncState = "idle" | "syncing" | "offline" | "signed-out" | "not-configured" | "error";

export interface SyncStatus {
  mode: SyncMode;
  state: SyncState;
  email: string | null;
  message: string | null;
  lastSyncedAt: number | null;
  pending: number;
  progress: { done: number; total: number } | null;
  filesEnabled: boolean;
}

interface PersistedSyncState {
  email: string | null;
  cursor: string | null;
  pendingUpserts: string[];
  pendingDeletes: string[];
  dirtyCollections: CollectionName[];
  collectionStamps: Partial<Record<CollectionName, number>>;
  lastSyncedAt: number | null;
}

interface AccountSnapshot {
  format: 1;
  transactions: string;
  collections: Partial<Record<CollectionName, unknown>>;
  sync: PersistedSyncState;
}

const emptyState = (): PersistedSyncState => ({
  email: null,
  cursor: null,
  pendingUpserts: [],
  pendingDeletes: [],
  dirtyCollections: [],
  collectionStamps: {},
  lastSyncedAt: null,
});

function accountDataKey(email: string): string {
  return `${ACCOUNT_DATA_KEY_PREFIX}${encodeURIComponent(email.trim().toLowerCase())}`;
}

function normalisePersistedState(value: unknown, email?: string | null): PersistedSyncState {
  const stored = value && typeof value === "object" ? value as Partial<PersistedSyncState> : {};
  const collectionStamps: Partial<Record<CollectionName, number>> = {};
  if (stored.collectionStamps && typeof stored.collectionStamps === "object") {
    for (const name of COLLECTION_NAMES) {
      const stamp = stored.collectionStamps[name];
      if (typeof stamp === "number" && Number.isFinite(stamp)) collectionStamps[name] = stamp;
    }
  }
  return {
    email: email === undefined ? (typeof stored.email === "string" ? stored.email : null) : email,
    cursor: typeof stored.cursor === "string" ? stored.cursor : null,
    pendingUpserts: Array.isArray(stored.pendingUpserts) ? stored.pendingUpserts.filter((id): id is string => typeof id === "string") : [],
    pendingDeletes: Array.isArray(stored.pendingDeletes) ? stored.pendingDeletes.filter((id): id is string => typeof id === "string") : [],
    dirtyCollections: Array.isArray(stored.dirtyCollections)
      ? stored.dirtyCollections.filter((name): name is CollectionName => COLLECTION_NAMES.includes(name as CollectionName))
      : [],
    collectionStamps,
    lastSyncedAt: typeof stored.lastSyncedAt === "number" && Number.isFinite(stored.lastSyncedAt) ? stored.lastSyncedAt : null,
  };
}

function parseAccountSnapshot(value: string | null): AccountSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AccountSnapshot>;
    if (parsed.format !== 1 || typeof parsed.transactions !== "string") return null;
    return {
      format: 1,
      transactions: parsed.transactions,
      collections: parsed.collections && typeof parsed.collections === "object" ? parsed.collections : {},
      sync: normalisePersistedState(parsed.sync, null),
    };
  } catch {
    return null;
  }
}

export type CollectionValues = Record<CollectionName, unknown[]>;

interface Options {
  loaded: boolean;
  transactions: Transaction[];
  setTransactions: (next: Transaction[]) => void;
  collections: CollectionValues;
  /** Applies a collection received from the cloud; returns the value as stored by the app. */
  applyCollection: (name: CollectionName, data: unknown) => unknown[];
}

function toMap(transactions: Transaction[]): Map<string, Transaction> {
  return new Map(transactions.map((transaction) => [transaction.id, transaction]));
}

export function useCloudSync({ loaded, transactions, setTransactions, collections, applyCollection }: Options) {
  const [status, setStatus] = useState<SyncStatus>({
    mode: "checking", state: "idle", email: null, message: null, lastSyncedAt: null, pending: 0, progress: null, filesEnabled: false,
  });

  const persisted = useRef<PersistedSyncState>(emptyState());
  const persistedLoaded = useRef(false);
  const pendingUpserts = useRef(new Set<string>());
  const pendingDeletes = useRef(new Set<string>());
  const inFlightUpserts = useRef(new Set<string>());
  const inFlightDeletes = useRef(new Set<string>());
  const dirtyCollections = useRef(new Set<CollectionName>());
  const baseline = useRef<Map<string, Transaction> | null>(null);
  const applyingRemote = useRef(false);
  const latestTransactions = useRef(transactions);
  const latestCollections = useRef(collections);
  const knownCollectionJson = useRef<Partial<Record<CollectionName, string>>>({});
  const mode = useRef<SyncMode>("checking");
  const running = useRef<Promise<void> | null>(null);
  const rerun = useRef(false);
  const pushTimer = useRef<number | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);

  latestTransactions.current = transactions;
  latestCollections.current = collections;

  const pendingCount = () =>
    pendingUpserts.current.size + pendingDeletes.current.size + inFlightUpserts.current.size + inFlightDeletes.current.size + dirtyCollections.current.size;

  const savePersisted = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      persisted.current.pendingUpserts = [...new Set([...pendingUpserts.current, ...inFlightUpserts.current])];
      persisted.current.pendingDeletes = [...new Set([...pendingDeletes.current, ...inFlightDeletes.current])];
      persisted.current.dirtyCollections = [...dirtyCollections.current];
      void writeValue(SYNC_STATE_KEY, JSON.stringify(persisted.current));
    }, 400);
  }, []);

  const update = useCallback((patch: Partial<SyncStatus>) => {
    setStatus((current) => ({ ...current, ...patch, pending: pendingCount() }));
  }, []);

  const replaceTransactions = useCallback((next: Transaction[]) => {
    applyingRemote.current = true;
    baseline.current = toMap(next);
    latestTransactions.current = next;
    setTransactions(next);
  }, [setTransactions]);

  /* ------------------------------------------------------------ pulling */

  const pullAll = useCallback(async (after: string, onPage?: (count: number) => void) => {
    const rows: Array<[SyncRow, 0 | 1, number]> = [];
    let cursor = after;
    for (;;) {
      const page = await cloudApi.transactionsPage(cursor);
      rows.push(...page.rows);
      cursor = page.next;
      onPage?.(rows.length);
      if (!page.hasMore) break;
    }
    return { rows, cursor };
  }, []);

  /** Merges server changes into local data. Unsynced local edits win over server copies. */
  const applyServerRows = useCallback((rows: Array<[SyncRow, 0 | 1, number]>, firstSync: boolean) => {
    const local = toMap(latestTransactions.current);
    const seen = new Set<string>();
    let changed = false;
    for (const [row, deleted] of rows) {
      const id = row[0];
      seen.add(id);
      if (pendingUpserts.current.has(id) || pendingDeletes.current.has(id) || inFlightUpserts.current.has(id) || inFlightDeletes.current.has(id)) continue;
      if (deleted) {
        if (local.delete(id)) changed = true;
        continue;
      }
      const incoming = fromSyncRow(row, isCategory);
      if (!incoming) continue;
      const existing = local.get(id);
      if (existing && sameRow(existing, incoming)) continue;
      local.set(id, incoming);
      changed = true;
    }
    if (firstSync) {
      // Anything only on this device (e.g. history from before cloud sync) is uploaded.
      for (const id of local.keys()) {
        if (!seen.has(id)) pendingUpserts.current.add(id);
      }
    }
    if (changed) replaceTransactions([...local.values()]);
  }, [replaceTransactions]);

  /* ------------------------------------------------------------ pushing */

  const pushTransactions = useCallback(async () => {
    const queue: Array<{ kind: "upsert" | "delete"; id: string }> = [
      ...[...pendingUpserts.current].map((id) => ({ kind: "upsert" as const, id })),
      ...[...pendingDeletes.current].map((id) => ({ kind: "delete" as const, id })),
    ];
    const total = queue.length;
    if (!total) return;
    // Move everything to "in flight"; it stays in the saved queue until the server confirms it.
    for (const item of queue) (item.kind === "upsert" ? inFlightUpserts : inFlightDeletes).current.add(item.id);
    pendingUpserts.current.clear();
    pendingDeletes.current.clear();
    const current = toMap(latestTransactions.current);
    let done = 0;
    try {
      while (queue.length) {
        const chunk = queue.slice(0, MAX_ROWS_PER_REQUEST);
        const rows = chunk.flatMap((item) => {
          const transaction = item.kind === "upsert" ? current.get(item.id) : undefined;
          return transaction ? [toSyncRow(transaction)] : [];
        });
        const deletes = chunk.filter((item) => item.kind === "delete" || !current.has(item.id)).map((item) => item.id);
        await cloudApi.writeTransactions(rows, deletes);
        queue.splice(0, chunk.length);
        for (const item of chunk) (item.kind === "upsert" ? inFlightUpserts : inFlightDeletes).current.delete(item.id);
        done += chunk.length;
        if (total > MAX_ROWS_PER_REQUEST) update({ state: "syncing", progress: { done, total } });
        savePersisted();
      }
    } catch (error) {
      // Whatever the server did not confirm goes back in the queue (unless edited again meanwhile, which re-queued it).
      for (const item of queue) {
        if (item.kind === "upsert" && !pendingDeletes.current.has(item.id)) pendingUpserts.current.add(item.id);
        if (item.kind === "delete" && !pendingUpserts.current.has(item.id)) pendingDeletes.current.add(item.id);
      }
      inFlightUpserts.current.clear();
      inFlightDeletes.current.clear();
      savePersisted();
      throw error;
    }
  }, [savePersisted, update]);

  const pushCollections = useCallback(async () => {
    for (const name of [...dirtyCollections.current]) {
      const data = latestCollections.current[name];
      const { updatedAt } = await cloudApi.saveCollection(name, data);
      persisted.current.collectionStamps[name] = updatedAt;
      knownCollectionJson.current[name] = JSON.stringify(data);
      dirtyCollections.current.delete(name);
    }
    savePersisted();
  }, [savePersisted]);

  const syncCollections = useCallback(async (firstSync: boolean) => {
    const { collections: remote } = await cloudApi.collections();
    for (const name of COLLECTION_NAMES) {
      const server = remote[name];
      const local = latestCollections.current[name];
      if (dirtyCollections.current.has(name)) continue;
      const stamp = persisted.current.collectionStamps[name];
      if (server && (stamp === undefined || server.updatedAt > stamp)) {
        const serverEmpty = Array.isArray(server.data) && server.data.length === 0;
        if (firstSync && serverEmpty && local.length) {
          dirtyCollections.current.add(name);
          continue;
        }
        const stored = applyCollection(name, server.data);
        knownCollectionJson.current[name] = JSON.stringify(stored);
        persisted.current.collectionStamps[name] = server.updatedAt;
      } else if (!server && local.length) {
        dirtyCollections.current.add(name);
      }
    }
    await pushCollections();
  }, [applyCollection, pushCollections]);

  /* ---------------------------------------------------------- full cycle */

  const runSync = useCallback(async () => {
    if (mode.current !== "cloud") return;
    const firstSync = persisted.current.cursor === null;
    update({ state: "syncing", message: firstSync ? "Connecting your history to the cloud…" : null, progress: null });
    const { rows, cursor } = await pullAll(persisted.current.cursor ?? "0:", firstSync
      ? (count) => update({ message: `Downloading your cloud history… ${count.toLocaleString("en-NG")} rows` })
      : undefined);
    applyServerRows(rows, firstSync);
    persisted.current.cursor = cursor;
    if (firstSync && pendingUpserts.current.size) {
      update({ message: `Uploading ${pendingUpserts.current.size.toLocaleString("en-NG")} transactions from this device…`, progress: { done: 0, total: pendingUpserts.current.size } });
    }
    await pushTransactions();
    await syncCollections(firstSync);
    persisted.current.lastSyncedAt = Date.now();
    savePersisted();
    update({ state: "idle", message: null, progress: null, lastSyncedAt: persisted.current.lastSyncedAt });
  }, [applyServerRows, pullAll, pushTransactions, savePersisted, syncCollections, update]);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof CloudError) {
      if (error.kind === "no-api") {
        mode.current = "local";
        update({ mode: "local", state: "idle", message: null, progress: null });
        return;
      }
      const state: SyncState = error.kind === "offline" ? "offline" : error.kind === "signed-out" ? "signed-out" : error.kind === "not-configured" ? "not-configured" : "error";
      update({ state, message: error.message, progress: null });
      return;
    }
    update({ state: "error", message: "Sync failed. Your changes are kept on this device and will be retried.", progress: null });
  }, [update]);

  const sync = useCallback(async () => {
    if (mode.current !== "cloud") return;
    if (running.current) {
      rerun.current = true;
      return running.current;
    }
    const work = (async () => {
      do {
        rerun.current = false;
        try {
          await runSync();
        } catch (error) {
          handleError(error);
          return;
        }
      } while (rerun.current);
    })();
    running.current = work;
    try {
      await work;
    } finally {
      running.current = null;
    }
  }, [handleError, runSync]);

  const schedulePush = useCallback(() => {
    window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => void sync(), PUSH_DELAY);
  }, [sync]);

  /* ----------------------------------------------- startup and connection */

  const connect = useCallback(async () => {
    let account: CloudAccount;
    try {
      account = await cloudApi.me();
    } catch (error) {
      // Known cloud user who is offline/signed out: keep queuing changes for later.
      if (persisted.current.email && error instanceof CloudError && error.kind !== "no-api" && error.kind !== "not-configured") {
        mode.current = "cloud";
        update({ mode: "cloud", email: persisted.current.email, lastSyncedAt: persisted.current.lastSyncedAt });
        handleError(error);
        return;
      }
      // Never connected (or the cloud is not set up): keep working from this browser.
      mode.current = "local";
      const notConfigured = error instanceof CloudError && error.kind === "not-configured";
      const signedOut = error instanceof CloudError && error.kind === "signed-out";
      update({
        mode: "local",
        state: notConfigured ? "not-configured" : signedOut ? "signed-out" : "idle",
        message: notConfigured
          ? error.message
          : signedOut
            ? "Your data stays in this browser until you sign in to sync."
            : null,
        progress: null,
      });
      return;
    }
    if (persisted.current.email && persisted.current.email !== account.email) {
      // Preserve the previous identity's local-only work, but never merge it into the
      // next identity's first sync. Each account gets its own browser-side snapshot.
      window.clearTimeout(pushTimer.current);
      window.clearTimeout(saveTimer.current);
      const previousEmail = persisted.current.email;
      const previousSync: PersistedSyncState = {
        ...persisted.current,
        pendingUpserts: [...new Set([...pendingUpserts.current, ...inFlightUpserts.current])],
        pendingDeletes: [...new Set([...pendingDeletes.current, ...inFlightDeletes.current])],
        dirtyCollections: [...dirtyCollections.current],
      };
      const previousSnapshot: AccountSnapshot = {
        format: 1,
        transactions: serializeTransactions(latestTransactions.current),
        collections: latestCollections.current,
        sync: previousSync,
      };
      const savedPrevious = await writeValue(accountDataKey(previousEmail), JSON.stringify(previousSnapshot));
      if (!savedPrevious) {
        mode.current = "local";
        update({
          mode: "local",
          state: "error",
          message: "Cloud sync is paused because this browser could not safely separate account data. Check browser storage and try again.",
          progress: null,
        });
        return;
      }

      const nextSnapshot = parseAccountSnapshot(await readValue(accountDataKey(account.email)));
      const nextSync = nextSnapshot
        ? normalisePersistedState(nextSnapshot.sync, account.email)
        : { ...emptyState(), email: account.email };
      persisted.current = nextSync;
      pendingUpserts.current.clear();
      pendingDeletes.current.clear();
      inFlightUpserts.current.clear();
      inFlightDeletes.current.clear();
      dirtyCollections.current.clear();
      nextSync.pendingUpserts.forEach((id) => pendingUpserts.current.add(id));
      nextSync.pendingDeletes.forEach((id) => pendingDeletes.current.add(id));
      nextSync.dirtyCollections.forEach((name) => dirtyCollections.current.add(name));

      const nextTransactions = nextSnapshot ? parseStoredTransactions(nextSnapshot.transactions) : [];
      replaceTransactions(nextTransactions);
      const nextCollections = {} as CollectionValues;
      for (const name of COLLECTION_NAMES) {
        const data = nextSnapshot?.collections[name];
        const value = applyCollection(name, Array.isArray(data) ? data : []);
        nextCollections[name] = value;
        knownCollectionJson.current[name] = JSON.stringify(value);
      }
      latestCollections.current = nextCollections;

      // Persist the new identity before starting network sync. Otherwise a reload in
      // the debounce window could restore the previous account's global browser cache.
      const [transactionsSaved, syncStateSaved] = await Promise.all([
        writeValue(TRANSACTIONS_STORAGE_KEY, serializeTransactions(nextTransactions)),
        writeValue(SYNC_STATE_KEY, JSON.stringify(persisted.current)),
      ]);
      if (!transactionsSaved || !syncStateSaved) {
        mode.current = "local";
        update({
          mode: "local",
          state: "error",
          email: account.email,
          message: "Cloud sync is paused because the new account's local cache could not be saved safely. Check browser storage and try again.",
          progress: null,
        });
        return;
      }
    }
    if (!account.storage.database) {
      mode.current = "local";
      update({ mode: "local", state: "not-configured", email: account.email, message: "Signed in, but the D1 database is not connected to this Pages project yet." });
      return;
    }
    persisted.current.email = account.email;
    mode.current = "cloud";
    update({ mode: "cloud", email: account.email, filesEnabled: account.storage.files, lastSyncedAt: persisted.current.lastSyncedAt });
    await sync();
  }, [applyCollection, handleError, replaceTransactions, sync, update]);

  // Load the persisted sync bookkeeping once the local data is in memory.
  useEffect(() => {
    if (!loaded || persistedLoaded.current) return;
    persistedLoaded.current = true;
    baseline.current = toMap(latestTransactions.current);
    for (const name of COLLECTION_NAMES) knownCollectionJson.current[name] = JSON.stringify(latestCollections.current[name]);
    void readValue(SYNC_STATE_KEY).then((value) => {
      try {
        const stored = value ? normalisePersistedState(JSON.parse(value)) : emptyState();
        persisted.current = stored;
        stored.pendingUpserts.forEach((id) => pendingUpserts.current.add(id));
        stored.pendingDeletes.forEach((id) => pendingDeletes.current.add(id));
        stored.dirtyCollections.forEach((name) => dirtyCollections.current.add(name));
      } catch {
        persisted.current = emptyState();
      }
      void connect();
    });
  }, [loaded, connect]);

  // Track local transaction edits.
  useEffect(() => {
    if (!loaded || !persistedLoaded.current || !baseline.current) return;
    if (applyingRemote.current) {
      applyingRemote.current = false;
      baseline.current = toMap(transactions);
      return;
    }
    const previous = baseline.current;
    const next = toMap(transactions);
    let changes = 0;
    for (const [id, transaction] of next) {
      const before = previous.get(id);
      if (before === transaction || (before && sameRow(before, transaction))) continue;
      pendingUpserts.current.add(id);
      pendingDeletes.current.delete(id);
      changes += 1;
    }
    for (const id of previous.keys()) {
      if (next.has(id)) continue;
      pendingDeletes.current.add(id);
      pendingUpserts.current.delete(id);
      changes += 1;
    }
    baseline.current = next;
    if (!changes || mode.current !== "cloud") return;
    savePersisted();
    update({});
    schedulePush();
  }, [transactions, loaded, savePersisted, schedulePush, update]);

  // Track local collection edits.
  useEffect(() => {
    if (!loaded || !persistedLoaded.current) return;
    let changed = false;
    for (const name of COLLECTION_NAMES) {
      const json = JSON.stringify(collections[name]);
      if (knownCollectionJson.current[name] === json) continue;
      knownCollectionJson.current[name] = json;
      dirtyCollections.current.add(name);
      changed = true;
    }
    if (!changed || mode.current !== "cloud") return;
    savePersisted();
    update({});
    schedulePush();
  }, [collections, loaded, savePersisted, schedulePush, update]);

  // Pick up changes from other devices; retry after going offline.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void (mode.current === "cloud" ? sync() : undefined);
    };
    const onOnline = () => void (persisted.current.email ? connect() : undefined);
    const timer = window.setInterval(onFocus, PULL_INTERVAL);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [connect, sync]);

  /* ------------------------------------------------------- statement files */

  const listStatements = useCallback(async (): Promise<StoredStatement[]> => (await cloudApi.statements()).statements, []);
  const uploadStatement = useCallback(async (file: File, rowsImported: number) => cloudApi.uploadStatement(file, rowsImported), []);
  const deleteStatement = useCallback(async (id: string) => {
    await cloudApi.deleteStatement(id);
  }, []);

  const listBackups = useCallback(async (): Promise<StoredBackup[]> => (await cloudApi.backups()).backups, []);
  const createCloudBackup = useCallback(async (): Promise<StoredBackup> => (await cloudApi.createCloudBackup()).backup, []);
  const deleteCloudBackup = useCallback(async (id: string) => {
    await cloudApi.deleteCloudBackup(id);
  }, []);

  const signIn = useCallback(() => {
    window.location.assign(cloudApi.signInUrl());
  }, []);

  const syncNow = useCallback(async () => {
    if (mode.current === "cloud" && status.state !== "signed-out") await sync();
    else await connect();
  }, [connect, status.state, sync]);

  return {
    status,
    syncNow,
    signIn,
    listStatements,
    uploadStatement,
    deleteStatement,
    statementUrl: cloudApi.statementUrl,
    listBackups,
    createCloudBackup,
    deleteCloudBackup,
    backupUrl: cloudApi.backupUrl,
  };
}

