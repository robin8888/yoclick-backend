import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

const EXPO_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

export class RegisterPushDeviceRequestDto extends createZodDto(
  z.strictObject({
    /** El token que da Expo en el móvil (`ExponentPushToken[...]`). */
    token: z.string().regex(EXPO_TOKEN_PATTERN),
    platform: z.enum(['ios', 'android']),
  }),
) {}

export class UnregisterPushDeviceRequestDto extends createZodDto(
  z.strictObject({ token: z.string().regex(EXPO_TOKEN_PATTERN) }),
) {}
