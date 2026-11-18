import { mediaApi, type MediaEntityType } from "@/lib/api";

interface PendingPhotoRequest {
  entityType: MediaEntityType;
  id: string;
  resolve: (url: string | null) => void;
  reject: (reason: unknown) => void;
}

const queue: PendingPhotoRequest[] = [];
const inFlight = new Map<string, Promise<string | null>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function requestKey(entityType: MediaEntityType, id: string): string {
  return `${entityType}:${id}`;
}

const MAX_BATCH_SIZE = 200;

async function flushQueue(): Promise<void> {
  flushTimer = null;
  const batch = queue.splice(0, queue.length);
  if (batch.length === 0) return;

  try {
    const urls = new Map<string, string | null>();
    for (let offset = 0; offset < batch.length; offset += MAX_BATCH_SIZE) {
      const chunk = batch.slice(offset, offset + MAX_BATCH_SIZE);
      const response = await mediaApi.getPhotoUrls(
        chunk.map(({ entityType, id }) => ({ entityType, id })),
      );
      for (const item of response.data.items) {
        urls.set(requestKey(item.entityType, item.id), item.signedUrl);
      }
    }
    for (const request of batch) {
      request.resolve(urls.get(requestKey(request.entityType, request.id)) ?? null);
    }
  } catch (err) {
    for (const request of batch) request.reject(err);
  } finally {
    for (const request of batch) {
      inFlight.delete(requestKey(request.entityType, request.id));
    }
  }
}

/**
 * Resolves an EnrollPro photo URL through a shared micro-batch so a roster
 * triggers one POST instead of one request per avatar.
 */
export function getEntityPhotoUrl(
  entityType: MediaEntityType,
  id: string,
): Promise<string | null> {
  const key = requestKey(entityType, id);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = new Promise<string | null>((resolve, reject) => {
    queue.push({ entityType, id, resolve, reject });
  });
  inFlight.set(key, promise);

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flushQueue();
    }, 40);
  }

  return promise;
}
