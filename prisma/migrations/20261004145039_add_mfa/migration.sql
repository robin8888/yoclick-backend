-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "mfa_verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ,
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfa_factors_user_id_key" ON "mfa_factors"("user_id");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- RLS por persona (SEC-41): el segundo factor y sus códigos de recuperación son solo de su dueña.
-- ============================================================================
ALTER TABLE "mfa_factors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mfa_factors" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_mfa_factor ON "mfa_factors"
  USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE "mfa_recovery_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mfa_recovery_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_mfa_recovery_codes ON "mfa_recovery_codes"
  USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
