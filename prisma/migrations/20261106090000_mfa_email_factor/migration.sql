-- Segundo factor por código enviado al correo: nuevo propósito de código y método del factor.
ALTER TYPE "verification_purpose" ADD VALUE 'mfa_email';

CREATE TYPE "mfa_method" AS ENUM ('totp', 'email');

ALTER TABLE "mfa_factors" ADD COLUMN "method" "mfa_method" NOT NULL DEFAULT 'totp';

-- El método por correo no tiene secreto; el de la app sigue exigiéndolo.
ALTER TABLE "mfa_factors" ALTER COLUMN "secret_enc" DROP NOT NULL;
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_totp_requires_secret"
  CHECK ("method" = 'email' OR "secret_enc" IS NOT NULL);
