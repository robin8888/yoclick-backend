-- CreateEnum
CREATE TYPE "consent_kind" AS ENUM ('privacy', 'terms', 'marketing', 'health', 'image', 'parental');

-- CreateEnum
CREATE TYPE "verification_purpose" AS ENUM ('email_verification', 'password_reset');

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "consent_kind" NOT NULL,
    "version" TEXT NOT NULL,
    "is_granted" BOOLEAN NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "verification_purpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consents_user_id_kind_granted_at_idx" ON "consents"("user_id", "kind", "granted_at");

-- CreateIndex
CREATE INDEX "verification_codes_user_id_purpose_created_at_idx" ON "verification_codes"("user_id", "purpose", "created_at");

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- RLS por persona (SEC-41): cada quien solo ve y toca lo suyo.
-- ============================================================================
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consents" FORCE ROW LEVEL SECURITY;

CREATE POLICY own_consents_read ON "consents" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY own_consents_insert ON "consents" FOR INSERT
  WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Inmutable: los permisos por defecto concedieron todo; aquí se retira. Cambiar un consentimiento
-- es insertar una fila nueva (RGPD: queda la prueba de cuándo se concedió y cuándo se retiró).
REVOKE UPDATE, DELETE ON "consents" FROM yoclick_app;

ALTER TABLE "verification_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_codes" FORCE ROW LEVEL SECURITY;

CREATE POLICY own_verification_codes ON "verification_codes"
  USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
