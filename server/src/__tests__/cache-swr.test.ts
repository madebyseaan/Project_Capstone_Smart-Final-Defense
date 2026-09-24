/**
 * cache-swr.test.ts — T1 unit tests for syncCache stale-while-revalidate (P1).
 * No DB, no network.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { syncCache, invalidatePrefix, invalidateAllCaches } from "../lib/syncCache";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("syncCache stale-while-revalidate", () => {
  beforeEach(() => syncCache.invalidate());

  it("returns fresh values without fetching", async () => {
    syncCache.set("k-fresh", { v: 1 }, 60_000);
    let calls = 0;
    const value = await syncCache.getOrFetch("k-fresh", async () => {
      calls += 1;
      return { v: 2 };
    });
    expect(value).toEqual({ v: 1 });
    expect(calls).toBe(0);
  });

  it("serves stale immediately and refreshes in the background", async () => {
    syncCache.set("k-stale", "old", 10, 1000);
    await sleep(25);
    const value = await syncCache.getOrFetch("k-stale", async () => "new");
    expect(value).toBe("old");
    await sleep(10);
    expect(syncCache.get("k-stale")).toBe("new");
  });

  it("falls back to stale when the refresh fails inside the window", async () => {
    syncCache.set("k-fail", "old", 10, 1000);
    await sleep(25);
    const value = await syncCache.getOrFetch("k-fail", async () => {
      throw new Error("down");
    });
    expect(value).toBe("old");
  });

  it("throws when the entry is beyond the stale window", async () => {
    syncCache.set("k-expired", "old", 10, 20);
    await sleep(45);
    await expect(
      syncCache.getOrFetch("k-expired", async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
  });

  it("kill switch: staleTtlMs=0 disables stale serving", async () => {
    syncCache.set("k-nostale", "old", 10, 0);
    await sleep(25);
    await expect(
      syncCache.getOrFetch(
        "k-nostale",
        async () => {
          throw new Error("down");
        },
        { staleTtlMs: 0 },
      ),
    ).rejects.toThrow("down");
  });

  it("single-flight: concurrent misses trigger one fetch", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await sleep(30);
      return "v";
    };
    const [a, b] = await Promise.all([
      syncCache.getOrFetch("k-single", fetcher),
      syncCache.getOrFetch("k-single", fetcher),
    ]);
    expect(a).toBe("v");
    expect(b).toBe("v");
    expect(calls).toBe(1);
  });

  it("getWithStatus reports freshness and age", async () => {
    syncCache.set("k-status", "v", 10, 1000);
    const fresh = syncCache.getWithStatus<string>("k-status");
    expect(fresh).toMatchObject({ data: "v", stale: false });
    await sleep(25);
    const stale = syncCache.getWithStatus<string>("k-status");
    expect(stale?.stale).toBe(true);
  });
});

describe("syncCache invalidation", () => {
  beforeEach(() => syncCache.invalidate());

  it("invalidatePrefix removes only the matching keys", () => {
    syncCache.set("enrollpro:teachers", [1]);
    syncCache.set("enrollpro:sections:1", [2]);
    syncCache.set("atlas:faculty", [3]);
    syncCache.set("aims:course:x", {});
    invalidatePrefix("enrollpro:");
    expect(syncCache.stats().keys.sort()).toEqual(["aims:course:x", "atlas:faculty"]);
  });

  it("invalidateAllCaches clears everything", () => {
    syncCache.set("enrollpro:teachers", [1]);
    syncCache.set("atlas:faculty", [3]);
    invalidateAllCaches();
    expect(syncCache.stats().size).toBe(0);
  });
});
