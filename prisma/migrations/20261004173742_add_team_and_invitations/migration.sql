-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "staff_title" TEXT;

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "membership_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_center_id_email_idx" ON "invitations"("center_id", "email");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_not_owner" CHECK ("role" <> 'owner');

-- RLS (SEC-41), como el resto de tablas del centro. Nada de DELETE: una invitación se revoca, no se borra.
GRANT SELECT, INSERT, UPDATE ON "invitations" TO yoclick_app;
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "invitations"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);

-- Quien recibe el código (sin sesión o aún sin pertenecer al centro) ve SOLO la invitación cuyo hash presenta.
CREATE POLICY lookup_by_token_hash ON "invitations" FOR SELECT
  USING ("token_hash" = NULLIF(current_setting('app.lookup_invitation_hash', true), ''));
