-- Mensajes internos: alumno <-> profesor, y cada persona <-> el centro. Una conversación es siempre
-- de dos partes: la persona (`member`) y, o bien otra persona (`counterpart`), o bien el centro
-- (`counterpart` nulo: la bandeja del centro, que ve la administración y solo esa).

ALTER TYPE "notification_kind" ADD VALUE 'message_received';

CREATE TYPE "message_attachment_kind" AS ENUM ('image', 'pdf');

CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "member_membership_id" UUID NOT NULL,
    "counterpart_membership_id" UUID,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "member_last_read_at" TIMESTAMPTZ,
    "other_last_read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversations_pair_key"
  ON "conversations"("center_id", "member_membership_id", "counterpart_membership_id")
  WHERE "counterpart_membership_id" IS NOT NULL;
CREATE UNIQUE INDEX "conversations_center_inbox_key"
  ON "conversations"("center_id", "member_membership_id")
  WHERE "counterpart_membership_id" IS NULL;
CREATE INDEX "conversations_center_id_last_message_at_idx" ON "conversations"("center_id", "last_message_at");
CREATE INDEX "conversations_counterpart_membership_id_idx" ON "conversations"("counterpart_membership_id");

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_member_membership_id_fkey"
  FOREIGN KEY ("member_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_counterpart_membership_id_fkey"
  FOREIGN KEY ("counterpart_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_distinct_parties"
  CHECK ("counterpart_membership_id" IS NULL OR "counterpart_membership_id" <> "member_membership_id");

CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "center_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_membership_id" UUID NOT NULL,
    "body" TEXT,
    "attachment_key" TEXT,
    "attachment_kind" "message_attachment_kind",
    "attachment_name" TEXT,
    "attachment_size_bytes" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

ALTER TABLE "messages" ADD CONSTRAINT "messages_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_membership_id_fkey"
  FOREIGN KEY ("sender_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_has_content" CHECK (
  ("body" IS NOT NULL AND length(btrim("body")) > 0) OR "attachment_key" IS NOT NULL
);
ALTER TABLE "messages" ADD CONSTRAINT "messages_attachment_complete" CHECK (
  ("attachment_key" IS NULL AND "attachment_kind" IS NULL)
  OR ("attachment_key" IS NOT NULL AND "attachment_kind" IS NOT NULL)
);

-- Un mensaje enviado no se borra.
REVOKE DELETE ON "messages" FROM yoclick_app;

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversations"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
-- Una conversación la ven sus dos partes. La administración, solo las dirigidas al centro: las que
-- una persona tiene con otra (alumno y profesor) no las lee ni el dueño.
CREATE POLICY parties_only ON "conversations" AS RESTRICTIVE
  USING (
    "member_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
    OR "counterpart_membership_id" = NULLIF(current_setting('app.membership_id', true), '')::uuid
    OR (
      "counterpart_membership_id" IS NULL
      AND NULLIF(current_setting('app.role', true), '') IN ('owner', 'admin')
    )
  );

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "messages"
  USING ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid)
  WITH CHECK ("center_id" = NULLIF(current_setting('app.center_id', true), '')::uuid);
-- Un mensaje se ve si se ve su conversación (la subconsulta ya pasa por la política de arriba).
CREATE POLICY conversation_visible ON "messages" AS RESTRICTIVE
  USING (EXISTS (SELECT 1 FROM "conversations" c WHERE c."id" = "conversation_id"));
