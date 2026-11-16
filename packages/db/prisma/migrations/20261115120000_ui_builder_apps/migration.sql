-- CreateEnum
CREATE TYPE "AppAccess" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'layout-dashboard',
    "color" TEXT NOT NULL DEFAULT '#7c3aed',
    "definition" JSONB NOT NULL,
    "access" "AppAccess" NOT NULL DEFAULT 'PRIVATE',
    "publishedVersionId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppVersion" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "message" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "App_slug_key" ON "App"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "App_publishedVersionId_key" ON "App"("publishedVersionId");

-- CreateIndex
CREATE INDEX "App_workspaceId_idx" ON "App"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AppVersion_appId_version_key" ON "AppVersion"("appId", "version");

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "AppVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppVersion" ADD CONSTRAINT "AppVersion_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

