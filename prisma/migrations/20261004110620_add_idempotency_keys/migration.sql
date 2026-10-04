-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('in_progress', 'completed');

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'in_progress',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- RLS por persona: cada quien solo ve y toca sus propias claves (SEC-41).
-- Sin app.user_id en el contexto no coincide ninguna fila (deny by default).
-- Los permisos sobre la tabla ya los concede ALTER DEFAULT PRIVILEGES de la migración inicial.
-- ============================================================================
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;

CREATE POLICY own_idempotency_keys ON "idempotency_keys"
  USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
