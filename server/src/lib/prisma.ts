import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL!;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString,
        max: 10,
        min: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      },
      {
        onPoolError: (err) => {
          console.error("[Prisma] Pool error:", err.message);
        },
        onConnectionError: (err) => {
          console.error("[Prisma] Connection error:", err.message);
        },
      },
    ),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
