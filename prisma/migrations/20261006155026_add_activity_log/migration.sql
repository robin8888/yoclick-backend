-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "actor_membership_id" UUID,
    "kind" TEXT NOT NULL,
    "subject" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_center_id_created_at_idx" ON "activity_logs"("center_id", "created_at");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El registro solo se añade: ni se edita ni se borra, ni siquiera por error de la aplicación.
REVOKE UPDATE, DELETE ON "activity_logs" FROM yoclick_app;

-- Row Level Security (SEC-41), como el resto de tablas del centro.
ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "activity_logs"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
