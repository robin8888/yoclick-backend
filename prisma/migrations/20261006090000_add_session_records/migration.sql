-- Registro de la clase (API-312): quién la inició y la terminó y cuándo, para el temporizador y el informe.
ALTER TABLE "bookings"
  ADD COLUMN "started_at" TIMESTAMPTZ,
  ADD COLUMN "ended_at" TIMESTAMPTZ,
  ADD COLUMN "started_by_membership_id" UUID,
  ADD COLUMN "ended_by_membership_id" UUID,
  ADD COLUMN "session_notes" TEXT;

-- Una clase no puede terminar sin haber empezado ni antes de empezar; las notas, acotadas.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_times_check"
  CHECK ("ended_at" IS NULL OR ("started_at" IS NOT NULL AND "ended_at" >= "started_at"));
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_notes_length_check"
  CHECK ("session_notes" IS NULL OR char_length("session_notes") <= 500);

-- CreateIndex
CREATE INDEX "bookings_center_id_started_at_idx" ON "bookings"("center_id", "started_at");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_started_by_membership_id_fkey" FOREIGN KEY ("started_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ended_by_membership_id_fkey" FOREIGN KEY ("ended_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
