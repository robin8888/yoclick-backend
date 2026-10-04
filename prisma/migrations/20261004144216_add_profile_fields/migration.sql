-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birth_date" DATE,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'es-ES',
ADD COLUMN     "phone" TEXT;
