-- Si el centro lo activa, las clases y citas se inician solas a su hora.
ALTER TABLE "centers" ADD COLUMN "auto_start_sessions" BOOLEAN NOT NULL DEFAULT false;

-- El barrido que inicia las citas solo necesita saber qué centros lo tienen activado: lee esas filas
-- y nada más; después trabaja ya dentro de cada centro con las políticas de siempre.
CREATE POLICY auto_start_sweep ON "centers" FOR SELECT
  USING (
    current_setting('app.lookup_auto_start_sweep', true) = 'on'
    AND "auto_start_sessions"
  );
