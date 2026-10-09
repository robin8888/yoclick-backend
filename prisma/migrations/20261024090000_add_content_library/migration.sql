-- CreateEnum
CREATE TYPE "content_kind" AS ENUM ('video', 'pdf');

-- AlterTable: todos los planes incluyen PDF; el tope de espacio (1 GB por defecto) lo sube Yoclick.
ALTER TABLE "centers" ADD COLUMN "document_storage_limit_bytes" BIGINT NOT NULL DEFAULT 1073741824;

-- CreateTable
CREATE TABLE "content_items" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "kind" "content_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "need" TEXT,
    "level" "client_level",
    "video_id" UUID,
    "document_key" TEXT,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "page_count" INTEGER,
    "created_by_membership_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_assignments" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "level" "client_level",
    "group_id" UUID,
    "client_membership_id" UUID,
    "assigned_by_membership_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_items_video_id_key" ON "content_items"("video_id");
CREATE UNIQUE INDEX "content_items_document_key_key" ON "content_items"("document_key");
CREATE INDEX "content_items_center_id_idx" ON "content_items"("center_id");
CREATE INDEX "content_assignments_center_id_content_id_idx" ON "content_assignments"("center_id", "content_id");
CREATE INDEX "content_assignments_group_id_idx" ON "content_assignments"("group_id");
CREATE INDEX "content_assignments_client_membership_id_idx" ON "content_assignments"("client_membership_id");

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_assignments" ADD CONSTRAINT "content_assignments_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_assignments" ADD CONSTRAINT "content_assignments_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_assignments" ADD CONSTRAINT "content_assignments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "client_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_assignments" ADD CONSTRAINT "content_assignments_client_membership_id_fkey" FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_assignments" ADD CONSTRAINT "content_assignments_assigned_by_membership_id_fkey" FOREIGN KEY ("assigned_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Integridad
-- ============================================================================
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_title_not_blank" CHECK (length(btrim("title")) BETWEEN 1 AND 120);
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_need_not_blank" CHECK ("need" IS NULL OR length(btrim("need")) BETWEEN 1 AND 40);
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_size_valid" CHECK ("size_bytes" >= 0);
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_page_count_valid" CHECK ("page_count" IS NULL OR "page_count" > 0);
-- Un vídeo apunta a su vídeo y un PDF a su fichero, nunca a las dos cosas.
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_one_source" CHECK (
  ("kind" = 'video' AND "video_id" IS NOT NULL AND "document_key" IS NULL)
  OR ("kind" = 'pdf' AND "document_key" IS NOT NULL AND "video_id" IS NULL)
);
ALTER TABLE "centers" ADD CONSTRAINT "centers_document_storage_limit_valid" CHECK ("document_storage_limit_bytes" >= 0);
-- Una asignación es a un nivel, a un grupo o a una persona: solo a uno de los tres.
ALTER TABLE "content_assignments" ADD CONSTRAINT "content_assignments_one_target" CHECK (
  (("level" IS NOT NULL)::int + ("group_id" IS NOT NULL)::int + ("client_membership_id" IS NOT NULL)::int) = 1
);
CREATE UNIQUE INDEX "content_assignments_content_level_key" ON "content_assignments" ("content_id", "level") WHERE "level" IS NOT NULL;
CREATE UNIQUE INDEX "content_assignments_content_group_key" ON "content_assignments" ("content_id", "group_id") WHERE "group_id" IS NOT NULL;
CREATE UNIQUE INDEX "content_assignments_content_client_key" ON "content_assignments" ("content_id", "client_membership_id") WHERE "client_membership_id" IS NOT NULL;

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "content_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "content_items"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

ALTER TABLE "content_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "content_assignments"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
