-- Extensiones que necesita el esquema. Son "de confianza": las puede crear el dueño de la base.
CREATE EXTENSION IF NOT EXISTS citext;      -- emails sin distinguir mayúsculas
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- restricciones EXCLUDE de solapes (tickets de agenda)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "center_status" AS ENUM ('trial', 'active', 'past_due', 'suspended');

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('owner', 'admin', 'staff', 'client');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('invited', 'active', 'blocked', 'left');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "centers" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "brand_color" CHAR(7) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "join_code" CHAR(6) NOT NULL,
    "status" "center_status" NOT NULL DEFAULT 'trial',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "centers_slug_key" ON "centers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "centers_join_code_key" ON "centers"("join_code");

-- CreateIndex
CREATE INDEX "memberships_center_id_role_idx" ON "memberships"("center_id", "role");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_center_id_user_id_key" ON "memberships"("center_id", "user_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Restricciones que Prisma no modela
-- ============================================================================
ALTER TABLE "centers" ADD CONSTRAINT "centers_brand_color_format"
  CHECK ("brand_color" ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE "centers" ADD CONSTRAINT "centers_join_code_format"
  CHECK ("join_code" ~ '^[A-Z0-9]{6}$');

-- ============================================================================
-- Permisos mínimos del rol de la API (SEC-63): solo filas, nunca DDL.
-- Se conceden tabla a tabla (no "ALL TABLES") para que _prisma_migrations quede fuera.
-- ============================================================================
GRANT USAGE ON SCHEMA public TO yoclick_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "users", "centers", "memberships" TO yoclick_app;
ALTER DEFAULT PRIVILEGES FOR ROLE yoclick_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yoclick_app;

-- ============================================================================
-- Row Level Security (SEC-41). FORCE: el dueño de la tabla también queda sujeto.
--
-- El contexto de la petición se fija con set_config(..., true) dentro de la transacción.
-- NULLIF(..., ''): al terminar la transacción, una conexión reutilizada devuelve '' (no NULL)
-- y ''::uuid fallaría. Sin contexto la política no coincide con ninguna fila: deny by default.
-- ============================================================================
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "memberships"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- "Mis centros": una persona lee sus propias membresías en todos los centros.
-- SOLO sin centro en contexto: las políticas permisivas se combinan con OR, y dentro de un
-- centro quien pertenece a varios vería sus filas de los demás.
CREATE POLICY own_memberships_read ON "memberships" FOR SELECT
  USING (
    NULLIF(current_setting('app.center_id', true), '') IS NULL
    AND "user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

ALTER TABLE "centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "centers" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "centers"
  USING ("id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- Un usuario ve los centros a los que pertenece (la subconsulta pasa por la RLS de memberships).
-- También solo sin centro en contexto, por la misma razón que arriba.
CREATE POLICY member_reads_own_centers ON "centers" FOR SELECT
  USING (NULLIF(current_setting('app.center_id', true), '') IS NULL AND EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."center_id" = "centers"."id"
      AND m."user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));
