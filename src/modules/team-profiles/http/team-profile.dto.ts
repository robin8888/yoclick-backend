import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { videoViewShape } from '../../videos/http/video.dto';
import {
  MAX_BIO_LENGTH,
  MAX_CERTIFICATION_DETAIL_LENGTH,
  MAX_CERTIFICATION_NAME_LENGTH,
  MAX_HEADLINE_LENGTH,
  MAX_LIST_ITEM_LENGTH,
  MAX_LIST_ITEMS,
  MAX_MOD_NOTE_LENGTH,
  MAX_RATING,
  MAX_REVIEW_COMMENT_LENGTH,
  MIN_RATING,
} from '../domain/profile-rules';

export class CenterParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class MemberParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), membershipId: z.uuid() }),
) {}

export class CertificationParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), certificationId: z.uuid() }),
) {}

export class MemberCertificationParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), membershipId: z.uuid(), certificationId: z.uuid() }),
) {}

export class ReviewParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), reviewId: z.uuid() }),
) {}

/** Una cadena vacía (campo en blanco del formulario) cuenta como «no viene». */
const optionalText = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(maxLength).nullable().default(null),
  );

const textList = z.array(z.string().max(MAX_LIST_ITEM_LENGTH)).max(MAX_LIST_ITEMS);

export class SaveProfileRequestDto extends createZodDto(
  z.strictObject({
    headline: optionalText(MAX_HEADLINE_LENGTH),
    bio: optionalText(MAX_BIO_LENGTH),
    specialties: textList.default([]),
    languages: textList.default([]),
    /** Autoriza al centro a publicar su imagen y sus vídeos; sin esto no se puede enviar a revisión. */
    hasPublishConsent: z.boolean(),
  }),
) {}

export class AddCertificationRequestDto extends createZodDto(
  z.strictObject({
    name: z.string().trim().min(1).max(MAX_CERTIFICATION_NAME_LENGTH),
    detail: optionalText(MAX_CERTIFICATION_DETAIL_LENGTH),
  }),
) {}

export class ReviewProfileRequestDto extends createZodDto(
  z
    .strictObject({
      decision: z.enum(['approve', 'request_changes']),
      note: optionalText(MAX_MOD_NOTE_LENGTH),
    })
    .refine(({ decision, note }) => decision === 'approve' || note !== null, {
      path: ['note'],
      message: 'say what has to change',
    }),
) {}

export class CreateReviewRequestDto extends createZodDto(
  z.strictObject({
    rating: z.number().int().min(MIN_RATING).max(MAX_RATING),
    comment: optionalText(MAX_REVIEW_COMMENT_LENGTH),
  }),
) {}

export class ModerateReviewRequestDto extends createZodDto(
  z.strictObject({ decision: z.enum(['approve', 'reject']) }),
) {}

export class TeamSettingsRequestDto extends createZodDto(
  z
    .strictObject({
      showTeamOnWeb: z.boolean().optional(),
      reviewsNeedApproval: z.boolean().optional(),
    })
    .refine((settings) => Object.keys(settings).length > 0, 'send at least one setting'),
) {}

const profileShape = {
  membershipId: z.uuid(),
  /** `true` en el perfil de quien hace la petición. */
  isMe: z.boolean(),
  fullName: z.string(),
  staffTitle: z.string().nullable(),
  headline: z.string().nullable(),
  bio: z.string().nullable(),
  specialties: z.array(z.string()),
  languages: z.array(z.string()),
  status: z.enum(['draft', 'pending', 'published', 'changes_requested']),
  /** Lo que el centro pide cambiar; solo lo ve la propia persona y la administración. */
  reviewNote: z.string().nullable(),
  hasPublishConsent: z.boolean(),
  certifications: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      detail: z.string().nullable(),
      /** Comprobada por el centro. */
      isVerified: z.boolean(),
    }),
  ),
  introVideo: z.strictObject(videoViewShape).nullable(),
  techniqueVideos: z.array(z.strictObject(videoViewShape)),
  /** Media de las opiniones publicadas; nulo si todavía no hay. */
  rating: z.strictObject({ average: z.number(), count: z.number().int() }).nullable(),
};

export class ProfileResponseDto extends createZodDto(z.strictObject(profileShape)) {}

export class ProfileListResponseDto extends createZodDto(
  z.strictObject({ members: z.array(z.strictObject(profileShape)) }),
) {}

const reviewShape = {
  id: z.uuid(),
  staffMembershipId: z.uuid(),
  staffName: z.string(),
  /** Nombre e inicial del apellido: «Marta R.». */
  authorLabel: z.string(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  status: z.enum(['pending', 'published', 'rejected']),
  createdAt: z.iso.datetime(),
};

export class StaffReviewResponseDto extends createZodDto(z.strictObject(reviewShape)) {}

export class StaffReviewListResponseDto extends createZodDto(
  z.strictObject({ reviews: z.array(z.strictObject(reviewShape)) }),
) {}

export class TeamSettingsResponseDto extends createZodDto(
  z.strictObject({ showTeamOnWeb: z.boolean(), reviewsNeedApproval: z.boolean() }),
) {}
