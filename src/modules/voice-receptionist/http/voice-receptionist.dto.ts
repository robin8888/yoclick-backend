import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { paginationQueryShape } from '../../../shared/pagination/pagination-query.schema';
import { VOICE_CALL_OUTCOMES } from '../domain/call-outcome';

const FORWARDING_MODES = ['always', 'no_answer', 'busy', 'outside_hours'] as const;
const OVERAGE_POLICIES = ['continue_and_charge', 'disable_bot'] as const;
const MAX_TEXT_LENGTH = 500;
const MAX_SHORT_TEXT_LENGTH = 80;
const MIN_PHONE_LENGTH = 6;
const MAX_PHONE_LENGTH = 30;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

/** El cuerpo de un aviso del proveedor: su formato lo lee el adaptador, aquí solo se exige que sea un objeto. */
export class VoiceWebhookBodyDto extends createZodDto(z.looseObject({})) {}

export class VoiceWebhookResponseDto extends createZodDto(z.looseObject({})) {}

const CONFIG_SCHEMA = z.strictObject({
  greeting: z.string().nullable(),
  assistantName: z.string().nullable(),
  voice: z.string().nullable(),
  language: z.string(),
  forwardingMode: z.enum(FORWARDING_MODES),
  humanTransferPhone: z.string().nullable(),
  legalNotice: z.string().nullable(),
  transcriptRetentionDays: z.number().int(),
  overagePolicy: z.enum(OVERAGE_POLICIES),
});

const CAPABILITIES_SCHEMA = z.strictObject({
  canJoinWaitlist: z.boolean(),
  canBookGroupSessions: z.boolean(),
  canBookForChildren: z.boolean(),
  canCustomizeAssistant: z.boolean(),
  canSendPaymentLink: z.boolean(),
});

const USAGE_SCHEMA = z.strictObject({
  includedMinutes: z.number().int(),
  usedMinutes: z.number().int(),
  remainingMinutes: z.number().int(),
  overageMinutes: z.number().int(),
  usedPercent: z.number().int(),
});

export class VoiceOverviewResponseDto extends createZodDto(
  z.strictObject({
    planId: z.string(),
    isEnabled: z.boolean(),
    line: z
      .strictObject({ phoneNumber: z.string(), provider: z.string(), isActive: z.boolean() })
      .nullable(),
    subscription: z
      .strictObject({
        status: z.enum(['active', 'paused', 'cancelled']),
        includedMinutes: z.number().int(),
        periodStart: z.iso.datetime(),
        periodEnd: z.iso.datetime(),
      })
      .nullable(),
    config: CONFIG_SCHEMA.nullable(),
    addonPlan: z
      .strictObject({
        monthlyPriceCents: z.number().int(),
        includedMinutes: z.number().int(),
        overageCentsPerMinute: z.number().int(),
      })
      .nullable(),
    capabilities: CAPABILITIES_SCHEMA,
    usage: USAGE_SCHEMA.nullable(),
  }),
) {}

export class VoiceConfigResponseDto extends createZodDto(CONFIG_SCHEMA) {}

/** Solo viaja lo que se cambia: lo que falta se queda como estaba. Saludo, nombre y voz son de Premium. */
export class UpdateVoiceConfigRequestDto extends createZodDto(
  z.strictObject({
    greeting: z.string().trim().min(1).max(MAX_TEXT_LENGTH).nullable().optional(),
    assistantName: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH).nullable().optional(),
    voice: z.string().trim().min(1).max(MAX_SHORT_TEXT_LENGTH).nullable().optional(),
    forwardingMode: z.enum(FORWARDING_MODES).optional(),
    humanTransferPhone: z
      .string()
      .trim()
      .min(MIN_PHONE_LENGTH)
      .max(MAX_PHONE_LENGTH)
      .nullable()
      .optional(),
    legalNotice: z.string().trim().min(1).max(MAX_TEXT_LENGTH).nullable().optional(),
    transcriptRetentionDays: z
      .number()
      .int()
      .min(MIN_RETENTION_DAYS)
      .max(MAX_RETENTION_DAYS)
      .optional(),
    overagePolicy: z.enum(OVERAGE_POLICIES).optional(),
  }),
) {}

export class VoiceCallsQueryDto extends createZodDto(z.strictObject({ ...paginationQueryShape })) {}

export class VoiceCallsResponseDto extends createZodDto(
  z.strictObject({
    data: z.array(
      z.strictObject({
        id: z.uuid(),
        callerPhone: z.string(),
        callerName: z.string().nullable(),
        startedAt: z.iso.datetime(),
        durationSeconds: z.number().int().nullable(),
        outcome: z.enum(VOICE_CALL_OUTCOMES).nullable(),
        summary: z.string().nullable(),
        estimatedCostCents: z.number().int().nullable(),
        hasTranscript: z.boolean(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
) {}

export class VoiceUsageResponseDto extends createZodDto(
  z.strictObject({ periodStart: z.iso.datetime(), usage: USAGE_SCHEMA }),
) {}

export class StudentCodeResponseDto extends createZodDto(z.strictObject({ code: z.string() })) {}

export class ProvisionVoiceRequestDto extends createZodDto(
  z.strictObject({
    bridgeNumber: z.string().trim().min(MIN_PHONE_LENGTH).max(MAX_PHONE_LENGTH),
    provider: z.enum(['vapi', 'fake']),
    includedMinutes: z.number().int().min(0).optional(),
    /** Añade el add-on a la suscripción de Stripe del centro. Sin él (centro piloto) no se cobra nada. */
    shouldBillWithStripe: z.boolean().default(false),
  }),
) {}
