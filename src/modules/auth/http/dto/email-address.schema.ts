import { z } from 'zod';

const MAX_EMAIL_LENGTH = 254;

/** Correo normalizado (sin espacios, en minúsculas) y con longitud acotada antes de validarlo. */
export const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(MAX_EMAIL_LENGTH)
  .pipe(z.email());
