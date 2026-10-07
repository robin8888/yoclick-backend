-- CreateTable
CREATE TABLE "routines" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "created_by_membership_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routine_items" (
    "id" UUID NOT NULL,
    "routine_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "prescription" TEXT,

    CONSTRAINT "routine_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routine_assignments" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "routine_id" UUID NOT NULL,
    "client_membership_id" UUID,
    "group_id" UUID,
    "assigned_by_membership_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "routines_center_id_idx" ON "routines"("center_id");

-- CreateIndex
CREATE UNIQUE INDEX "routine_items_routine_id_position_key" ON "routine_items"("routine_id", "position");

-- CreateIndex
CREATE INDEX "routine_assignments_center_id_routine_id_idx" ON "routine_assignments"("center_id", "routine_id");

-- CreateIndex
CREATE INDEX "routine_assignments_client_membership_id_idx" ON "routine_assignments"("client_membership_id");

-- CreateIndex
CREATE INDEX "routine_assignments_group_id_idx" ON "routine_assignments"("group_id");

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_assignments" ADD CONSTRAINT "routine_assignments_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_assignments" ADD CONSTRAINT "routine_assignments_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_assignments" ADD CONSTRAINT "routine_assignments_client_membership_id_fkey" FOREIGN KEY ("client_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_assignments" ADD CONSTRAINT "routine_assignments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "client_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_assignments" ADD CONSTRAINT "routine_assignments_assigned_by_membership_id_fkey" FOREIGN KEY ("assigned_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Integridad: lo que la API valida, también en la base de datos.
-- ============================================================================
ALTER TABLE "routines" ADD CONSTRAINT "routines_name_not_blank" CHECK (length(btrim("name")) BETWEEN 1 AND 80);
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_name_not_blank" CHECK (length(btrim("name")) BETWEEN 1 AND 120);
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_position_valid" CHECK ("position" >= 0);
-- Una asignación es a una persona o a un grupo, nunca a las dos ni a ninguna.
ALTER TABLE "routine_assignments" ADD CONSTRAINT "routine_assignments_one_target" CHECK (
  ("client_membership_id" IS NOT NULL) <> ("group_id" IS NOT NULL)
);
-- La misma rutina no se asigna dos veces a la misma persona o grupo.
CREATE UNIQUE INDEX "routine_assignments_routine_client_key" ON "routine_assignments" ("routine_id", "client_membership_id") WHERE "client_membership_id" IS NOT NULL;
CREATE UNIQUE INDEX "routine_assignments_routine_group_key" ON "routine_assignments" ("routine_id", "group_id") WHERE "group_id" IS NOT NULL;

-- Una rutina se archiva, no se borra.
REVOKE DELETE ON "routines" FROM yoclick_app;

-- ============================================================================
-- Row Level Security (SEC-41), como el resto de tablas del centro.
-- ============================================================================
ALTER TABLE "routines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "routines"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

ALTER TABLE "routine_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "routine_assignments"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- Los ejercicios no llevan centro: heredan el aislamiento de su rutina.
ALTER TABLE "routine_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "routine_items"
  USING (EXISTS (
    SELECT 1 FROM "routines" r
    WHERE r."id" = "routine_items"."routine_id"
      AND r."center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "routines" r
    WHERE r."id" = "routine_items"."routine_id"
      AND r."center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
  ));
