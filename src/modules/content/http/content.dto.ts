import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { CLIENT_LEVELS } from '../../clients/domain/client-rules';
import { MAX_CONTENT_NEED_LENGTH, MAX_CONTENT_TITLE_LENGTH } from '../domain/content-rules';

const MAX_TARGETS = 50;

const titleSchema = z.string().trim().min(1).max(MAX_CONTENT_TITLE_LENGTH);
const needSchema = z.string().trim().min(1).max(MAX_CONTENT_NEED_LENGTH);
const levelSchema = z.enum(CLIENT_LEVELS);

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class ContentRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), contentId: z.uuid() }),
) {}

/** El PDF viaja como cuerpo del POST; lo que lo describe va en la dirección. */
export class AddDocumentQueryDto extends createZodDto(
  z.strictObject({
    title: titleSchema,
    need: needSchema.optional(),
    level: levelSchema.optional(),
  }),
) {}

export class AddVideoContentRequestDto extends createZodDto(
  z.strictObject({
    /** Un vídeo ya reservado con `videos_start_upload` (propósito `exercise`). */
    videoId: z.uuid(),
    title: titleSchema,
    need: needSchema.nullable().optional(),
    level: levelSchema.nullable().optional(),
  }),
) {}

export class UpdateContentRequestDto extends createZodDto(
  z
    .strictObject({
      title: titleSchema.optional(),
      need: needSchema.nullable().optional(),
      level: levelSchema.nullable().optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, { message: 'Nothing to change' }),
) {}

const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('level'), level: levelSchema }),
  z.strictObject({ kind: z.literal('group'), groupId: z.uuid() }),
  z.strictObject({ kind: z.literal('client'), membershipId: z.uuid() }),
]);

export class AssignContentRequestDto extends createZodDto(
  z.strictObject({
    /** A quién se le enseña la pieza; esta lista sustituye a la anterior. Vacía = sin asignar. */
    targets: z.array(targetSchema).max(MAX_TARGETS),
  }),
) {}

const assignmentShape = z.strictObject({
  id: z.uuid(),
  level: levelSchema.nullable(),
  groupId: z.uuid().nullable(),
  clientMembershipId: z.uuid().nullable(),
  /** Nombre del grupo o de la persona; nulo si es un nivel. */
  label: z.string().nullable(),
});

const contentViewShape = {
  id: z.uuid(),
  kind: z.enum(['video', 'pdf']),
  title: z.string(),
  need: z.string().nullable(),
  level: levelSchema.nullable(),
  sizeBytes: z.number().int().nonnegative(),
  pageCount: z.number().int().nullable(),
  durationSeconds: z.number().int().nullable(),
  isReady: z.boolean(),
  thumbnailUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  assignments: z.array(assignmentShape),
};

export class ContentResponseDto extends createZodDto(z.strictObject(contentViewShape)) {}

export class ContentLibraryResponseDto extends createZodDto(
  z.strictObject({
    items: z.array(z.strictObject(contentViewShape)),
    storage: z.strictObject({
      /** Espacio de PDF del plan y lo que ya ocupa. */
      limitBytes: z.number().int().nonnegative(),
      usedBytes: z.number().int().nonnegative(),
    }),
  }),
) {}

export class MyContentListResponseDto extends createZodDto(
  z.strictObject({ items: z.array(z.strictObject(contentViewShape)) }),
) {}

export class ContentDetailResponseDto extends createZodDto(
  z.strictObject({
    ...contentViewShape,
    playback: z
      .strictObject({
        streamUrl: z.string(),
        thumbnailUrl: z.string(),
        expiresAt: z.iso.datetime(),
      })
      .nullable(),
    document: z.strictObject({ url: z.string(), expiresAt: z.iso.datetime() }).nullable(),
  }),
) {}
