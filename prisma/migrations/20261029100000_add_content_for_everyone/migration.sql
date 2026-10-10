-- Destino «para todos»: la pieza la ve todo el alumnado del centro.
ALTER TABLE "content_assignments" ADD COLUMN "for_everyone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "content_assignments" DROP CONSTRAINT "content_assignments_one_target";
ALTER TABLE "content_assignments" ADD CONSTRAINT "content_assignments_one_target" CHECK (
  (("level" IS NOT NULL)::int + ("group_id" IS NOT NULL)::int + ("client_membership_id" IS NOT NULL)::int + "for_everyone"::int) = 1
);
CREATE UNIQUE INDEX "content_assignments_content_everyone_key" ON "content_assignments" ("content_id") WHERE "for_everyone";
