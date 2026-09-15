-- EnrollPro SSO identity link on User
ALTER TABLE "User" ADD COLUMN "enrollproSubject" TEXT;

-- CreateIndex: unique external subject link
CREATE UNIQUE INDEX "User_enrollproSubject_key" ON "User"("enrollproSubject");

-- CreateTable: CompanionSsoCode (reverse SSO one-time codes)
CREATE TABLE "CompanionSsoCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanionSsoCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanionSsoCode_codeHash_key" ON "CompanionSsoCode"("codeHash");

-- CreateIndex
CREATE INDEX "CompanionSsoCode_userId_idx" ON "CompanionSsoCode"("userId");

-- CreateIndex
CREATE INDEX "CompanionSsoCode_expiresAt_idx" ON "CompanionSsoCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "CompanionSsoCode" ADD CONSTRAINT "CompanionSsoCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
