import { createZodDto } from '../../../shared/http/create-zod-dto';
import { z } from 'zod';
import { TEAM_PERMISSIONS } from '../domain/team-rules';

const MAX_STAFF_TITLE_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;
const MAX_INVITATION_CODE_INPUT_LENGTH = 24;

const roleSchema = z.enum(['owner', 'admin', 'staff', 'client']);
const statusSchema = z.enum(['invited', 'active', 'blocked', 'left']);

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class TeamMemberRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), membershipId: z.uuid() }),
) {}

export class InvitationRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), invitationId: z.uuid() }),
) {}

export class InvitationCodeParamsDto extends createZodDto(
  z.strictObject({ code: z.string().min(1).max(MAX_INVITATION_CODE_INPUT_LENGTH) }),
) {}

const teamMemberShape = {
  membershipId: z.uuid(),
  userId: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  role: roleSchema,
  status: statusSchema,
  staffTitle: z.string().nullable(),
  permissions: z.array(z.enum(TEAM_PERMISSIONS)),
  joinedAt: z.iso.datetime(),
};

export class TeamMemberResponseDto extends createZodDto(z.strictObject(teamMemberShape)) {}
export class TeamResponseDto extends createZodDto(
  z.strictObject({ members: z.array(z.strictObject(teamMemberShape)) }),
) {}

export class UpdateTeamMemberRequestDto extends createZodDto(
  z
    .strictObject({
      role: z.enum(['admin', 'staff']).optional(),
      status: z.enum(['active', 'blocked', 'left']).optional(),
      permissions: z
        .array(z.enum(TEAM_PERMISSIONS))
        .max(TEAM_PERMISSIONS.length)
        .refine((permissions) => new Set(permissions).size === permissions.length, 'duplicated')
        .optional(),
      staffTitle: z.string().trim().min(1).max(MAX_STAFF_TITLE_LENGTH).nullable().optional(),
    })
    .refine((update) => Object.keys(update).length > 0, 'send at least one field to change'),
) {}

const MAX_PHONE_INPUT_LENGTH = 24;

/** Al correo (lo envía la API) o al teléfono (lo comparte la app por WhatsApp o SMS): uno de los dos. */
export class InviteRequestDto extends createZodDto(
  z
    .strictObject({
      email: z.email().max(MAX_EMAIL_LENGTH).optional(),
      phone: z.string().trim().min(1).max(MAX_PHONE_INPUT_LENGTH).optional(),
      role: z.enum(['admin', 'staff', 'client']),
    })
    .refine(
      ({ email, phone }) => (email === undefined) !== (phone === undefined),
      'send an email or a phone, not both',
    ),
) {}

const invitationShape = {
  id: z.uuid(),
  /** Nulo si se invitó por teléfono. */
  email: z.string().nullable(),
  /** Teléfono normalizado (`+34600111222`); nulo si se invitó por correo. */
  phone: z.string().nullable(),
  role: roleSchema,
  expiresAt: z.iso.datetime(),
};

export class InvitationResponseDto extends createZodDto(
  z.strictObject({
    ...invitationShape,
    /** El código para compartirlo (`ABCD-EFGH-JKLM`). Solo se devuelve al crearla. */
    code: z.string(),
  }),
) {}
export class PendingInvitationsResponseDto extends createZodDto(
  z.strictObject({
    invitations: z.array(z.strictObject({ ...invitationShape, createdAt: z.iso.datetime() })),
  }),
) {}

export class InvitationPreviewResponseDto extends createZodDto(
  z.strictObject({
    role: roleSchema,
    /** Nulo si se invitó por teléfono: la persona se registra con el correo que quiera. */
    emailHint: z.string().nullable(),
    expiresAt: z.iso.datetime(),
    center: z.strictObject({
      id: z.uuid(),
      name: z.string(),
      sectorId: z.string(),
      brandColor: z.string(),
      logoUrl: z.string().nullable(),
    }),
  }),
) {}

export class AcceptedInvitationResponseDto extends createZodDto(
  z.strictObject({
    membershipId: z.uuid(),
    centerId: z.uuid(),
    role: roleSchema,
    status: statusSchema,
  }),
) {}
