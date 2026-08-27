/**
 * useSyncStream.ts
 *
 * React hook that connects to the server's SSE sync-status stream and
 * exposes a `syncVersion` counter that increments whenever a background
 * sync cycle completes.
 *
 * Usage:
 *   const { syncVersion } = useSyncStream();
 *   useEffect(() => { fetchData(); }, [syncVersion]);
 *
 * The hook uses fetch() + ReadableStream instead of EventSource so it can
 * send the Authorization header (EventSource does not support custom headers).
 * Auto-reconnects with exponential backoff on connection loss.
 */

import { useState, useEffect, useRef } from 'react';
import { getPortalToken } from "@/lib/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SSE_URL = '/api/integration/sync/stream';
const AUTH_REFRESH_URL = '/api/auth/refresh';
const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SyncCompletePayload {
  type: string;
  source: string;
  timestamp: string;
  durationMs?: number;
  result: {
    enrollpro: { students: number; advisories: number; errors: number } | null;
    atlas: { created: number; matched: number; errors: number } | null;
  };
}

export interface UseSyncStreamOptions {
  /** Called each time a SYNC_COMPLETE event arrives. */
  onSyncComplete?: (payload: SyncCompletePayload) => void;
}

export interface UseSyncStreamReturn {
  /** Increments by 1 on every SYNC_COMPLETE event. Safe to use as a useEffect dep. */
  syncVersion: number;
  /** True while the SSE connection is open. */
  isConnected: boolean;
  /** Timestamp of the last successful sync cycle. */
  lastSyncAt: Date | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useSyncStream(options?: UseSyncStreamOptions): UseSyncStreamReturn {
  const [syncVersion, setSyncVersion] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  // Keep a stable ref to the latest options so the effect closure doesn't go stale.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const abortRef = useRef<AbortController | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      const userData = sessionStorage.getItem('user');
      if (!userData) {
        // Not authenticated — don't attempt connection.
        return;
      }

      const token = getPortalToken();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Pass token as query param (SSE can't set headers) + cookies as fallback
        const url = token ? `${SSE_URL}?token=${encodeURIComponent(token)}` : SSE_URL;
        const response = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          // 403 = expired token — attempt refresh before giving up
          if (response.status === 403) {
            try {
              const refreshRes = await fetch(AUTH_REFRESH_URL, {
                method: 'POST',
                credentials: 'include',
              });
              if (refreshRes.ok) {
                const data = await refreshRes.json();
                if (data.token) {
                  sessionStorage.setItem('token', data.token);
                  backoffRef.current = INITIAL_BACKOFF_MS;
                  connect();
                  return;
                }
              }
            } catch {
              // Refresh failed — fall through to redirect
            }
            window.location.href = '/login';
            return;
          }
          throw new Error(`SSE connect failed: ${response.status}`);
        }

        if (cancelled) return;

        setIsConnected(true);
        backoffRef.current = INITIAL_BACKOFF_MS; // reset backoff on successful connect

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Read the stream line-by-line and process SSE data events.
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // SSE spec: messages separated by double newline.
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // keep incomplete last line in buffer

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue; // skip comments / heartbeats
            try {
              const payload = JSON.parse(line.slice(6)) as SyncCompletePayload;
              if (payload.type === 'SYNC_COMPLETE') {
                const syncAt = payload.timestamp ? new Date(payload.timestamp) : new Date();
                if (!cancelled) {
                  setLastSyncAt(syncAt);
                  setSyncVersion((v) => v + 1);
                  optionsRef.current?.onSyncComplete?.(payload);
                }
              }
            } catch {
              // Ignore JSON parse errors (malformed lines, heartbeats, etc.)
            }
          }
        }
      } catch (err: any) {
        // AbortError = intentional disconnect (component unmount / token change).
        if (err.name === 'AbortError') return;
        console.warn('[useSyncStream] Connection lost:', err.message);
      } finally {
        if (!cancelled) {
          setIsConnected(false);
          // Exponential backoff before reconnect.
          reconnectTimerRef.current = setTimeout(() => {
            if (!cancelled) {
              backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
              connect();
            }
          }, backoffRef.current);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      setIsConnected(false);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      abortRef.current?.abort();
    };
  }, []); // Connect once on mount; cleanup on unmount.

  return { syncVersion, isConnected, lastSyncAt };
}
