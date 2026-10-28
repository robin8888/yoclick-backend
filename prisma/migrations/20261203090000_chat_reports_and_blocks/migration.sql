-- Denunciar un mensaje y bloquear a una persona en el chat (Apple 1.2: contenido de usuarios).

-- Aviso a la administración de que alguien ha denunciado un mensaje.
ALTER TYPE "notification_kind" ADD VALUE 'message_reported';

CREATE TYPE "message_report_reason" AS ENUM ('spam', 'harassment', 'inappropriate', 'other');
CREATE TYPE "message_report_status" AS ENUM ('open', 'reviewed');

-- Una denuncia de un mensaje. Las conversaciones entre dos personas no las lee nadie más, tampoco el dueño:
-- por eso la denuncia guarda una COPIA del texto denunciado. Es una excepción explícita y acotada: la persona
-- que denuncia decide compartir ese mensaje (y solo ese) con la administración, para que pueda atenderlo.
CREATE TABLE "message_reports" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "reporter_membership_id" UUID NOT NULL,
    "reported_sender_membership_id" UUID NOT NULL,
    "reason" "message_report_reason" NOT NULL,
    "details" TEXT,
    "reported_body" TEXT,
    "reported_attachment_name" TEXT,
    "status" "message_report_status" NOT NULL DEFAULT 'open',
    "reviewed_by_membership_id" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_reports_details_length" CHECK ("details" IS NULL OR char_length("details") <= 500),
    CONSTRAINT "message_reports_review_consistent" CHECK (
      ("status" = 'open' AND "reviewed_at" IS NULL AND "reviewed_by_membership_id" IS NULL)
      OR ("status" = 'reviewed' AND "reviewed_at" IS NOT NULL)
    ),
    CONSTRAINT "message_reports_distinct_people" CHECK ("reporter_membership_id" <> "reported_sender_membership_id")
);

-- Una persona denuncia un mensaje una sola vez.
CREATE UNIQUE INDEX "message_reports_message_id_reporter_membership_id_key"
  ON "message_reports"("message_id", "reporter_membership_id");
CREATE INDEX "message_reports_center_id_status_created_at_idx"
  ON "message_reports"("center_id", "status", "created_at");

ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reporter_membership_id_fkey"
  FOREIGN KEY ("reporter_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reported_sender_membership_id_fkey"
  FOREIGN KEY ("reported_sender_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reviewed_by_membership_id_fkey"
  FOREIGN KEY ("reviewed_by_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una denuncia no se borra, y lo único que se corrige después es su revisión.
REVOKE DELETE ON "message_reports" FROM yoclick_app;
REVOKE UPDATE ON "message_reports" FROM yoclick_app;
GRANT UPDATE ("status", "reviewed_by_membership_id", "reviewed_at") ON "message_reports" TO yoclick_app;

ALTER TABLE "message_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_reports" FORCE ROW LEVEL SECURITY;
-- Denuncia quien participa en la conversación (lo comprueba la API al ver el mensaje) y solo en su nombre.
CREATE POLICY reporter_inserts ON "message_reports" FOR INSERT
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND "reporter_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );
CREATE POLICY reporter_reads_own ON "message_reports" FOR SELECT
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND "reporter_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );
-- Solo el dueño y la administración leen y revisan las denuncias de su centro.
CREATE POLICY admins_read ON "message_reports" FOR SELECT
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );
CREATE POLICY admins_review ON "message_reports" FOR UPDATE
  USING (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  )
  WITH CHECK (
    "center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid
    AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
  );

-- Quién ha bloqueado a quién. Solo entre alumno y profesor: la administración habla en nombre del centro.
CREATE TABLE "chat_blocks" (
    "center_id" UUID NOT NULL,
    "blocker_membership_id" UUID NOT NULL,
    "blocked_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_blocks_pkey" PRIMARY KEY ("blocker_membership_id", "blocked_membership_id"),
    CONSTRAINT "chat_blocks_distinct_people" CHECK ("blocker_membership_id" <> "blocked_membership_id")
);

CREATE INDEX "chat_blocks_center_id_idx" ON "chat_blocks"("center_id");
CREATE INDEX "chat_blocks_blocked_membership_id_idx" ON "chat_blocks"("blocked_membership_id");

ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_blocker_membership_id_fkey"
  FOREIGN KEY ("blocker_membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_blocked_membership_id_fkey"
  FOREIGN KEY ("blocked_membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE UPDATE ON "chat_blocks" FROM yoclick_app;

ALTER TABLE "chat_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_blocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "chat_blocks"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
-- Un bloqueo lo ven las dos personas (la bloqueada solo para que la API sepa que no puede escribir; la app
-- nunca se lo cuenta), pero solo lo crea y lo quita quien bloquea.
CREATE POLICY parties_read ON "chat_blocks" AS RESTRICTIVE FOR SELECT
  USING (
    "blocker_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
    OR "blocked_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
  );
CREATE POLICY blocker_inserts ON "chat_blocks" AS RESTRICTIVE FOR INSERT
  WITH CHECK ("blocker_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid);
CREATE POLICY blocker_deletes ON "chat_blocks" AS RESTRICTIVE FOR DELETE
  USING ("blocker_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid);
