-- ATLAS SSO identity link on User (ATLAS -> SMART reverse direction)
ALTER TABLE "User" ADD COLUMN "atlasSubject" TEXT;

-- CreateIndex: unique external subject link
CREATE UNIQUE INDEX "User_atlasSubject_key" ON "User"("atlasSubject");
