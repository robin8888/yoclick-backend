import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  DEFAULT_MESSAGE_PAGE_SIZE,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGE_PAGE_SIZE,
} from '../domain/chat-rules';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class ConversationRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), conversationId: z.uuid() }),
) {}

const ROLE_SCHEMA = z.enum(['owner', 'admin', 'staff', 'client']);

const ATTACHMENT_SCHEMA = z.strictObject({
  kind: z.enum(['image', 'pdf']),
  name: z.string(),
  sizeBytes: z.number().int(),
  /** Enlace firmado y de corta vida para descargarlo. */
  url: z.string(),
});

const MESSAGE_SCHEMA = z.strictObject({
  id: z.uuid(),
  conversationId: z.uuid(),
  senderMembershipId: z.uuid(),
  senderName: z.string(),
  body: z.string().nullable(),
  attachment: ATTACHMENT_SCHEMA.nullable(),
  createdAt: z.iso.datetime(),
});

export class MessageResponseDto extends createZodDto(MESSAGE_SCHEMA) {}

const COUNTERPART_SCHEMA = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('center') }),
  z.strictObject({
    kind: z.literal('person'),
    membershipId: z.uuid(),
    fullName: z.string(),
    role: ROLE_SCHEMA,
    photoUrl: z.string().nullable(),
  }),
]);

export class ConversationListResponseDto extends createZodDto(
  z.strictObject({
    unreadTotal: z.number().int(),
    conversations: z.array(
      z.strictObject({
        id: z.uuid(),
        counterpart: COUNTERPART_SCHEMA,
        lastMessage: MESSAGE_SCHEMA.nullable(),
        lastMessageAt: z.iso.datetime(),
        unreadCount: z.number().int(),
      }),
    ),
  }),
) {}

export class ContactListResponseDto extends createZodDto(
  z.strictObject({
    /** Si quien pregunta puede escribir «al centro» (toda la administración es el centro). */
    canWriteToCenter: z.boolean(),
    people: z.array(
      z.strictObject({
        membershipId: z.uuid(),
        fullName: z.string(),
        role: ROLE_SCHEMA,
        photoUrl: z.string().nullable(),
      }),
    ),
  }),
) {}

export class OpenConversationRequestDto extends createZodDto(
  z.strictObject({
    /** La persona con quien hablar; nulo o ausente, el centro. */
    withMembershipId: z.uuid().nullish(),
  }),
) {}

export class OpenConversationResponseDto extends createZodDto(
  z.strictObject({ conversationId: z.uuid() }),
) {}

export class MessageListQueryDto extends createZodDto(
  z.strictObject({
    /** Solo los anteriores a esta fecha (paginación hacia atrás). */
    before: z.iso.datetime().optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_MESSAGE_PAGE_SIZE)
      .default(DEFAULT_MESSAGE_PAGE_SIZE),
  }),
) {}

export class MessageListResponseDto extends createZodDto(
  z.strictObject({ messages: z.array(MESSAGE_SCHEMA) }),
) {}

export class SendMessageRequestDto extends createZodDto(
  z.strictObject({ body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }),
) {}

export class SendAttachmentQueryDto extends createZodDto(
  z.strictObject({ fileName: z.string().max(MAX_ATTACHMENT_NAME_LENGTH).optional() }),
) {}
