import { createZodDto } from '../../../shared/http/create-zod-dto';
import { z } from 'zod';

/** Los tipos de centro del producto; el vocabulario de cada uno vive en la app. */
export const SECTOR_IDS = [
  'gym',
  'estudio',
  'readap',
  'box',
  'yoga',
  'academia',
  'baile',
  'marciales',
  'musica',
  'cocina',
  'otro',
] as const;

const MIN_CENTER_NAME_LENGTH = 2;
const MAX_CENTER_NAME_LENGTH = 80;
const MAX_CITY_LENGTH = 80;
const DEFAULT_BRAND_COLOR = '#2446C7';

export class CreateCenterRequestDto extends createZodDto(
  z.strictObject({
    name: z.string().trim().min(MIN_CENTER_NAME_LENGTH).max(MAX_CENTER_NAME_LENGTH),
    sectorId: z.enum(SECTOR_IDS),
    /** Se ajusta después, al subir el logo; mientras tanto la app usa el azul de Yoclick. */
    brandColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .transform((color) => color.toUpperCase())
      .default(DEFAULT_BRAND_COLOR),
    city: z.string().trim().min(1).max(MAX_CITY_LENGTH).optional(),
  }),
) {}

export class CreateCenterResponseDto extends createZodDto(
  z.strictObject({
    centerId: z.uuid(),
    ownerMembershipId: z.uuid(),
    slug: z.string(),
    name: z.string(),
    sectorId: z.enum(SECTOR_IDS),
    brandColor: z.string(),
    /** El código con el que la clientela se une. Solo lo ve quien administra el centro. */
    joinCode: z.string(),
    trialEndsAt: z.iso.datetime(),
  }),
) {}
