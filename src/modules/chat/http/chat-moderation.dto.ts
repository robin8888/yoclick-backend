import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  DEFAULT_MESSAGE_REPORTS_PAGE_SIZE,
  MAX_MESSAGE_REPORTS_PER_PAGE,
  MAX_REPORT_DETAILS_LENGTH,
  MESSAGE_REPORT_REASONS,
} from '../domain/chat-moderation-rules';

const ROLE_SCHEMA = z.enum(['owner', 'admin', 'staff', 'client']);
const REPORT_STATUS_SCHEMA = z.enum(['open', 'reviewed']);

export class MessageRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), conversationId: z.uuid(), messageId: z.uuid() }),
) {}

export class MessageReportRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), reportId: z.uuid() }),
) {}

export class ChatBlockRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), blockedMembershipId: z.uuid() }),
) {}

export class ReportMessageRequestDto extends createZodDto(
  z.strictObject({
    reason: z.enum(MESSAGE_REPORT_REASONS),
    /** Lo que quiere contar quien denuncia; opcional. */
    details: z.string().trim().min(1).max(MAX_REPORT_DETAILS_LENGTH).optional(),
  }),
) {}

export class ReportMessageResponseDto extends createZodDto(
  z.strictObject({ reportId: z.uuid(), status: REPORT_STATUS_SCHEMA }),
) {}

const MESSAGE_REPORT_SCHEMA = z.strictObject({
  id: z.uuid(),
  reason: z.enum(MESSAGE_REPORT_REASONS),
  details: z.string().nullable(),
  status: REPORT_STATUS_SCHEMA,
  reporterName: z.string(),
  reportedSenderName: z.string(),
  /** Copia del texto denunciado: quien denuncia ha decidido compartirlo con la administración. */
  reportedBody: z.string().nullable(),
  /** Nombre del adjunto denunciado, si lo había; el fichero no se comparte. */
  reportedAttachmentName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
});

export class MessageReportResponseDto extends createZodDto(MESSAGE_REPORT_SCHEMA) {}

export class MessageReportListQueryDto extends createZodDto(
  z.strictObject({
    status: REPORT_STATUS_SCHEMA.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_MESSAGE_REPORTS_PER_PAGE)
      .default(DEFAULT_MESSAGE_REPORTS_PAGE_SIZE),
  }),
) {}

export class MessageReportListResponseDto extends createZodDto(
  z.strictObject({ reports: z.array(MESSAGE_REPORT_SCHEMA) }),
) {}

export class BlockPersonRequestDto extends createZodDto(
  z.strictObject({ blockedMembershipId: z.uuid() }),
) {}

const BLOCKED_PERSON_SCHEMA = z.strictObject({
  membershipId: z.uuid(),
  fullName: z.string(),
  role: ROLE_SCHEMA,
  photoUrl: z.string().nullable(),
  blockedAt: z.iso.datetime(),
});

export class BlockedPersonResponseDto extends createZodDto(BLOCKED_PERSON_SCHEMA) {}

export class BlockedPeopleResponseDto extends createZodDto(
  z.strictObject({ blocks: z.array(BLOCKED_PERSON_SCHEMA) }),
) {}
