-- CreateEnum
CREATE TYPE "notification_kind" AS ENUM ('booking_created', 'booking_cancelled');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "recipient_membership_id" UUID NOT NULL,
    "kind" "notification_kind" NOT NULL,
    "data" JSONB NOT NULL,
    "booking_id" UUID,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_center_id_recipient_membership_id_created_at_idx" ON "notifications"("center_id", "recipient_membership_id", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_id_fkey" FOREIGN KEY ("recipient_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
