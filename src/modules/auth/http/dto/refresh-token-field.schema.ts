import { z } from 'zod';

const MAX_REFRESH_TOKEN_LENGTH = 128;

/** Forma del token opaco (base64url): se rechaza lo que no lo parezca antes de tocar la base de datos. */
export const refreshTokenFieldSchema = z
  .string()
  .max(MAX_REFRESH_TOKEN_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);
