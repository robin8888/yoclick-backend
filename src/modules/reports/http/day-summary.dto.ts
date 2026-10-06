import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const MAX_OCCUPANCY_PERCENT = 100;

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class DaySummaryQueryDto extends createZodDto(z.strictObject({ date: z.iso.date() })) {}

export class DaySummaryResponseDto extends createZodDto(
  z.strictObject({
    date: z.iso.date(),
    /** Porcentaje (0–100) del tiempo del equipo reservado ese día; `null` si el centro cierra o nadie atiende. */
    occupancyPercent: z.number().int().min(0).max(MAX_OCCUPANCY_PERCENT).nullable(),
    /** Clientes que se unieron al centro en la semana (lunes a domingo) de la fecha. */
    newClientsThisWeek: z.number().int().min(0),
    activeClientCount: z.number().int().min(0),
  }),
) {}
