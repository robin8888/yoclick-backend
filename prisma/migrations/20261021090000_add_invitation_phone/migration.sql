-- AlterTable: una invitación puede ir a un correo o a un teléfono (WhatsApp, SMS).
ALTER TABLE "invitations" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "invitations" ADD COLUMN "phone" TEXT;

-- CreateIndex
CREATE INDEX "invitations_center_id_phone_idx" ON "invitations"("center_id", "phone");

-- Integridad: siempre hay a quién se envió, y el teléfono tiene forma de teléfono.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_recipient_present" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_phone_format" CHECK ("phone" IS NULL OR "phone" ~ '^\+[0-9]{8,15}$');
