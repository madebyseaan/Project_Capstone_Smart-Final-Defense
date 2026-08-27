import { TransmutationEntry } from "@prisma/client";
import { prisma } from "./prisma";

let cachedTable: TransmutationEntry[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getTransmutationTable(): Promise<TransmutationEntry[]> {
  const now = Date.now();
  if (cachedTable && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedTable;
  }
  cachedTable = await prisma.transmutationEntry.findMany({
    orderBy: { minGrade: 'asc' }
  });
  cacheTimestamp = now;
  return cachedTable;
}

export function invalidateTransmutationCache(): void {
  cachedTable = null;
  cacheTimestamp = 0;
}
