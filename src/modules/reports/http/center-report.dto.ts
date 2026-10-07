import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { REPORT_PERIODS } from '../domain/center-report';

const MAX_PERCENT = 100;
const percent = z.number().int().min(0).max(MAX_PERCENT);

export class ReportRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class CenterReportQueryDto extends createZodDto(
  z.strictObject({ period: z.enum(REPORT_PERIODS).default('month') }),
) {}

export class CenterReportResponseDto extends createZodDto(
  z.strictObject({
    period: z.enum(REPORT_PERIODS),
    /** Los últimos 7, 30 o 90 días contando hoy, en la zona del centro. */
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    /** En céntimos: precio del servicio por cada cita a la que vino la persona (o que ya pasó confirmada). No son cobros. */
    estimatedIncomeCents: z.number().int(),
    previousEstimatedIncomeCents: z.number().int(),
    /** Tiempo reservado sobre el tiempo abierto del equipo que atiende; `null` si no hay tiempo disponible. */
    averageOccupancyPercent: percent.nullable(),
    /** De quienes llevan al menos 90 días en el centro, quiénes tienen citas desde entonces. */
    retentionThreeMonthsPercent: percent.nullable(),
    activeClientCount: z.number().int(),
    /** Clientes sin cita en los últimos 30 días (los nuevos de la semana no cuentan). */
    inactiveClientCount: z.number().int(),
    /** Los últimos seis meses, de más antiguo a más reciente (`2026-09`). */
    incomeByMonth: z.array(z.strictObject({ month: z.string(), incomeCents: z.number().int() })),
    services: z.array(
      z.strictObject({
        serviceId: z.uuid(),
        name: z.string(),
        sessionCount: z.number().int(),
        occupancyPercent: percent.nullable(),
      }),
    ),
    staff: z.array(
      z.strictObject({
        membershipId: z.uuid(),
        fullName: z.string(),
        sessionCount: z.number().int(),
        hours: z.number(),
        occupancyPercent: percent.nullable(),
      }),
    ),
    retentionByJoinMonth: z.array(
      z.strictObject({
        month: z.string(),
        joinedCount: z.number().int(),
        retainedAfterOneMonthPercent: percent.nullable(),
        retainedAfterThreeMonthsPercent: percent.nullable(),
      }),
    ),
  }),
) {}
