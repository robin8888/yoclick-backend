import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { refreshTokenFieldSchema } from './refresh-token-field.schema';

const MAX_DEVICE_NAME_LENGTH = 100;

export class RefreshRequestDto extends createZodDto(
  z.strictObject({
    refreshToken: refreshTokenFieldSchema,
    deviceName: z.string().trim().min(1).max(MAX_DEVICE_NAME_LENGTH).optional(),
  }),
) {}
