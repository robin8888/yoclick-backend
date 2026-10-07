-- AlterEnum: avisos de lo que cambia en las citas y de las ausencias del equipo.
ALTER TYPE "notification_kind" ADD VALUE 'booking_created_by_team';
ALTER TYPE "notification_kind" ADD VALUE 'booking_cancelled_by_team';
ALTER TYPE "notification_kind" ADD VALUE 'absence_added';
ALTER TYPE "notification_kind" ADD VALUE 'booking_affected_by_absence';

-- AlterTable: cuándo se envió cada aviso al móvil.
ALTER TABLE "notifications" ADD COLUMN "pushed_at" TIMESTAMPTZ;

-- Los avisos que aún no se han enviado se buscan por centro y fecha.
CREATE INDEX "notifications_center_id_pushed_at_idx" ON "notifications"("center_id", "pushed_at");

-- CreateTable
CREATE TABLE "push_devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");

-- CreateIndex
CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integridad: lo que la API valida, también en la base de datos.
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_platform_valid" CHECK ("platform" IN ('ios', 'android'));
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_token_not_blank" CHECK (length(btrim("token")) BETWEEN 10 AND 300);
