-- AlterTable: quién aceptó la invitación, para que repetir la aceptación con la misma cuenta no falle.
ALTER TABLE "invitations" ADD COLUMN "accepted_by_user_id" UUID;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
