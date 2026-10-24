"use client";
// Check-ins/outs tapped without a connection are kept on the device and replayed later with
// their original time. Each carries a client id, so a replay can never create a duplicate.

export type QueuedEvent = {
  bookingId: string;
  type: "check_in" | "check_out";
  clientEventId: string;
  occurredAt: string;
  location: { lat: number; lng: number; accuracy: number | null } | null;
};

const KEY = "rgxm.attendance.queue.v1";

export function readQueue(): QueuedEvent[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedEvent[];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let memory: QueuedEvent[] = []; // fallback when storage is unavailable (private mode)

export function writeQueue(items: QueuedEvent[]) {
  memory = items;
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the in-memory copy keeps it for this page.
  }
  cachedRaw = null;
  listeners.forEach((l) => l());
}

// useSyncExternalStore needs a stable snapshot between changes.
let cachedRaw: string | null = null;
let cachedValue: QueuedEvent[] = [];
const EMPTY: QueuedEvent[] = [];

export function queueSnapshot(): QueuedEvent[] {
  let raw: string;
  try {
    raw = localStorage.getItem(KEY) ?? "[]";
  } catch {
    raw = JSON.stringify(memory);
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedValue = JSON.parse(raw) as QueuedEvent[];
    } catch {
      cachedValue = EMPTY;
    }
  }
  return cachedValue;
}

export const serverQueueSnapshot = () => EMPTY;

export function subscribeQueue(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Distinguishes "couldn't reach the server" from an answer the server gave. */
export function isNetworkError(err: unknown) {
  return err instanceof TypeError || (err instanceof Error && /fetch|network|load failed/i.test(err.message));
}

export function getLocationOnce(): Promise<QueuedEvent["location"]> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}
