-- CreateEnum
CREATE TYPE "privacy_request_kind" AS ENUM ('access', 'rectification', 'erasure', 'objection');

-- CreateEnum
CREATE TYPE "privacy_request_status" AS ENUM ('open', 'completed', 'rejected');

-- AlterEnum: avisos de las solicitudes de derechos (se envían por push).
ALTER TYPE "notification_kind" ADD VALUE 'privacy_request_received';
ALTER TYPE "notification_kind" ADD VALUE 'privacy_request_resolved';

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "client_membership_id" UUID NOT NULL,
    "kind" "privacy_request_kind" NOT NULL,
    "status" "privacy_request_status" NOT NULL DEFAULT 'open',
    "message" TEXT,
    "due_at" TIMESTAMPTZ NOT NULL,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by_membership_id" UUID,
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "privacy_requests_center_id_status_due_at_idx" ON "privacy_requests"("center_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "privacy_requests_client_membership_id_idx" ON "privacy_requests"("client_membership_id");

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_client_membership_id_fkey" FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_resolved_by_membership_id_fkey" FOREIGN KEY ("resolved_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Integridad
-- ============================================================================
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_message_length" CHECK ("message" IS NULL OR length("message") <= 500);
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_resolution_note_length" CHECK ("resolution_note" IS NULL OR length("resolution_note") <= 500);
-- Una solicitud resuelta dice cuándo y quién; una abierta, ninguna de las dos cosas.
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_resolution_consistent" CHECK (
  ("status" = 'open' AND "resolved_at" IS NULL AND "resolved_by_membership_id" IS NULL)
  OR ("status" <> 'open' AND "resolved_at" IS NOT NULL AND "resolved_by_membership_id" IS NOT NULL)
);
-- Una persona no tiene dos solicitudes abiertas del mismo derecho a la vez.
CREATE UNIQUE INDEX "privacy_requests_one_open_per_kind_key" ON "privacy_requests" ("client_membership_id", "kind") WHERE "status" = 'open';

-- Es la constancia de que se respondió a tiempo: no se borra.
REVOKE DELETE ON "privacy_requests" FROM yoclick_app;

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "privacy_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "privacy_requests"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
