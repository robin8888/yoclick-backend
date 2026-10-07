import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import {
  MAX_REVIEW_NOTE_LENGTH,
  MAX_VIDEO_SIZE_BYTES,
  MAX_VIDEO_TITLE_LENGTH,
} from '../domain/video-rules';

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class VideoRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), videoId: z.uuid() }),
) {}

export class StartVideoUploadRequestDto extends createZodDto(
  z.strictObject({
    title: z.string().trim().min(1).max(MAX_VIDEO_TITLE_LENGTH),
    /** Lo que pesa el fichero: sirve para reservar espacio antes de subirlo. */
    sizeBytes: z.number().int().positive().max(MAX_VIDEO_SIZE_BYTES),
    /** `exercise` para un ejercicio de rutina; `profile` para el vídeo de presentación de quien lo sube. */
    purpose: z.enum(['exercise', 'profile']),
  }),
) {}

export class ReviewVideoRequestDto extends createZodDto(
  z.strictObject({
    decision: z.enum(['approve', 'request_changes']),
    note: z.string().trim().min(1).max(MAX_REVIEW_NOTE_LENGTH).optional(),
  }),
) {}

export const videoViewShape = {
  id: z.uuid(),
  title: z.string(),
  status: z.enum(['uploading', 'processing', 'ready', 'failed']),
  reviewStatus: z.enum(['approved', 'pending', 'changes_requested']),
  reviewNote: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  /** Enlaces firmados que caducan; nulo mientras el vídeo no está listo o no se puede ver. */
  playback: z
    .strictObject({
      streamUrl: z.string(),
      thumbnailUrl: z.string(),
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
};

export class VideoResponseDto extends createZodDto(z.strictObject(videoViewShape)) {}

export class VideoPlanResponseDto extends createZodDto(
  z.strictObject({
    /** `false` si el plan del centro no incluye vídeo. */
    isIncluded: z.boolean(),
    /** Espacio contratado en bytes; nulo si no hay vídeo. */
    limitBytes: z.number().int().nullable(),
    usedBytes: z.number().int(),
  }),
) {}

export class StartVideoUploadResponseDto extends createZodDto(
  z.strictObject({
    video: z.strictObject(videoViewShape),
    upload: z.strictObject({
      /** A donde sube el móvil el fichero (protocolo TUS), sin pasar por la API. */
      endpoint: z.string(),
      /** Cabeceras que se envían tal cual; llevan una firma que caduca. */
      headers: z.record(z.string(), z.string()),
      expiresAt: z.iso.datetime(),
    }),
  }),
) {}

export class TeamProfilesResponseDto extends createZodDto(
  z.strictObject({
    members: z.array(
      z.strictObject({
        membershipId: z.uuid(),
        fullName: z.string(),
        staffTitle: z.string().nullable(),
        video: z.strictObject(videoViewShape).nullable(),
      }),
    ),
  }),
) {}
