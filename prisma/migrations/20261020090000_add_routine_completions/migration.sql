-- CreateTable
CREATE TABLE "routine_completions" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "routine_id" UUID NOT NULL,
    "client_membership_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_on" TEXT NOT NULL,
    "completed_item_count" INTEGER NOT NULL,
    "total_item_count" INTEGER NOT NULL,

    CONSTRAINT "routine_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routine_completions_routine_id_client_membership_id_completed_on_key" ON "routine_completions"("routine_id", "client_membership_id", "completed_on");

-- CreateIndex
CREATE INDEX "routine_completions_center_id_routine_id_idx" ON "routine_completions"("center_id", "routine_id");

-- CreateIndex
CREATE INDEX "routine_completions_client_membership_id_idx" ON "routine_completions"("client_membership_id");

-- AddForeignKey
ALTER TABLE "routine_completions" ADD CONSTRAINT "routine_completions_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_completions" ADD CONSTRAINT "routine_completions_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_completions" ADD CONSTRAINT "routine_completions_client_membership_id_fkey" FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Integridad
-- ============================================================================
ALTER TABLE "routine_completions" ADD CONSTRAINT "routine_completions_counts_valid" CHECK ("completed_item_count" >= 1 AND "completed_item_count" <= "total_item_count");
ALTER TABLE "routine_completions" ADD CONSTRAINT "routine_completions_day_format" CHECK ("completed_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- Es el historial de lo que la persona hizo: se registra, no se borra ni se reescribe.
REVOKE DELETE, UPDATE ON "routine_completions" FROM yoclick_app;

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "routine_completions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_completions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "routine_completions"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
