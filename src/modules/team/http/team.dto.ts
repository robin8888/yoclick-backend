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

export class InviteRequestDto extends createZodDto(
  z.strictObject({
    email: z.email().max(MAX_EMAIL_LENGTH),
    role: z.enum(['admin', 'staff', 'client']),
  }),
) {}

const invitationShape = {
  id: z.uuid(),
  email: z.string(),
  role: roleSchema,
  expiresAt: z.iso.datetime(),
};

export class InvitationResponseDto extends createZodDto(z.strictObject(invitationShape)) {}
export class PendingInvitationsResponseDto extends createZodDto(
  z.strictObject({
    invitations: z.array(z.strictObject({ ...invitationShape, createdAt: z.iso.datetime() })),
  }),
) {}

export class InvitationPreviewResponseDto extends createZodDto(
  z.strictObject({
    role: roleSchema,
    emailHint: z.string(),
    expiresAt: z.iso.datetime(),
    center: z.strictObject({
      id: z.uuid(),
      name: z.string(),
      sectorId: z.string(),
      brandColor: z.string(),
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
