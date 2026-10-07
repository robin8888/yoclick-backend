import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  MAX_PRIVACY_MESSAGE_LENGTH,
  MAX_RESOLUTION_NOTE_LENGTH,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_REQUEST_OUTCOMES,
} from '../domain/privacy-request-rules';

const MAX_PASSWORD_LENGTH_ACCEPTED = 256;

export class CenterParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class PrivacyRequestParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), requestId: z.uuid() }),
) {}

export class ClientDataExportParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), membershipId: z.uuid() }),
) {}

/** Una cadena vacía (campo en blanco del formulario) cuenta como «no viene». */
const optionalText = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(maxLength).nullable().default(null),
  );

export class CreatePrivacyRequestDto extends createZodDto(
  z.strictObject({
    kind: z.enum(PRIVACY_REQUEST_KINDS),
    message: optionalText(MAX_PRIVACY_MESSAGE_LENGTH),
  }),
) {}

export class ResolvePrivacyRequestDto extends createZodDto(
  z
    .strictObject({
      outcome: z.enum(PRIVACY_REQUEST_OUTCOMES),
      note: optionalText(MAX_RESOLUTION_NOTE_LENGTH),
    })
    .refine(({ outcome, note }) => outcome === 'completed' || note !== null, {
      path: ['note'],
      message: 'say why the request is rejected',
    }),
) {}

export class ClientDataExportRequestDto extends createZodDto(
  z.strictObject({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH_ACCEPTED) }),
) {}

const privacyRequestShape = {
  id: z.uuid(),
  clientMembershipId: z.uuid(),
  clientName: z.string(),
  kind: z.enum(PRIVACY_REQUEST_KINDS),
  status: z.enum(['open', 'completed', 'rejected']),
  message: z.string().nullable(),
  /** Fecha límite de respuesta: un mes desde que se recibe. */
  dueAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  resolutionNote: z.string().nullable(),
};

export class PrivacyRequestResponseDto extends createZodDto(z.strictObject(privacyRequestShape)) {}

export class PrivacyRequestListResponseDto extends createZodDto(
  z.strictObject({ requests: z.array(z.strictObject(privacyRequestShape)) }),
) {}

export class ClientDataExportResponseDto extends createZodDto(
  z.strictObject({
    exportedAt: z.iso.datetime(),
    person: z.strictObject({
      fullName: z.string(),
      email: z.string(),
      phone: z.string().nullable(),
      birthDate: z.string().nullable(),
    }),
    membership: z.strictObject({
      status: z.string(),
      joinedAt: z.iso.datetime(),
      level: z.string().nullable(),
      groupName: z.string().nullable(),
    }),
    bookings: z.array(
      z.strictObject({
        serviceName: z.string(),
        startsAt: z.iso.datetime(),
        status: z.string(),
        checkedInAt: z.iso.datetime().nullable(),
        cancelledAt: z.iso.datetime().nullable(),
      }),
    ),
    routines: z.array(z.strictObject({ name: z.string(), assignedAt: z.iso.datetime() })),
    privacyRequests: z.array(
      z.strictObject({
        kind: z.string(),
        status: z.string(),
        createdAt: z.iso.datetime(),
        resolvedAt: z.iso.datetime().nullable(),
      }),
    ),
  }),
) {}
