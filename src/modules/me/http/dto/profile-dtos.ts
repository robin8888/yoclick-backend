import { createZodDto } from '../../../../shared/http/create-zod-dto';
import { z } from 'zod';

const MIN_FULL_NAME_LENGTH = 2;
const MAX_FULL_NAME_LENGTH = 100;
const EARLIEST_BIRTH_YEAR = 1900;
const YEAR_DIGITS = 4;

/** Teléfono con prefijo opcional, dígitos, espacios, paréntesis y guiones. No valida que exista. */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s()-]{6,20}$/);

const birthDateSchema = z.iso.date().refine((value) => {
  const year = Number(value.slice(0, YEAR_DIGITS));
  return year >= EARLIEST_BIRTH_YEAR && new Date(`${value}T00:00:00.000Z`) <= new Date();
}, 'must be a past date');

export class UpdateProfileRequestDto extends createZodDto(
  z
    .strictObject({
      fullName: z.string().trim().min(MIN_FULL_NAME_LENGTH).max(MAX_FULL_NAME_LENGTH).optional(),
      phone: phoneSchema.nullable().optional(),
      birthDate: birthDateSchema.nullable().optional(),
      locale: z.enum(['es-ES', 'en']).optional(),
    })
    .refine((patch) => Object.keys(patch).length > 0, 'at least one field is required'),
) {}

const profileResponseSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  birthDate: z.iso.date().nullable(),
  locale: z.string(),
  isEmailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
});

export class ProfileResponseDto extends createZodDto(profileResponseSchema) {}

const membershipResponseSchema = z.strictObject({
  membershipId: z.uuid(),
  centerId: z.uuid(),
  role: z.enum(['owner', 'admin', 'staff', 'client']),
  status: z.enum(['invited', 'active', 'blocked', 'left']),
  joinedAt: z.iso.datetime(),
  center: z.strictObject({
    name: z.string(),
    slug: z.string(),
    sectorId: z.string(),
    brandColor: z.string(),
    logoUrl: z.string().nullable(),
  }),
});

export class MyMembershipsResponseDto extends createZodDto(
  z.strictObject({ memberships: z.array(membershipResponseSchema) }),
) {}

const consentStateSchema = z.strictObject({
  kind: z.enum(['privacy', 'terms', 'marketing', 'health', 'image', 'parental']),
  version: z.string(),
  isGranted: z.boolean(),
  grantedAt: z.iso.datetime(),
});

export class MyConsentsResponseDto extends createZodDto(
  z.strictObject({ consents: z.array(consentStateSchema) }),
) {}

export class SetConsentRequestDto extends createZodDto(
  z.strictObject({
    /** Solo los opcionales: privacidad y términos no se retiran sin eliminar la cuenta. */
    kind: z.enum(['marketing', 'image']),
    isGranted: z.boolean(),
  }),
) {}

export class PersonalDataExportResponseDto extends createZodDto(
  z.strictObject({
    exportedAt: z.iso.datetime(),
    profile: profileResponseSchema,
    memberships: z.array(membershipResponseSchema),
    consentHistory: z.array(consentStateSchema),
  }),
) {}
