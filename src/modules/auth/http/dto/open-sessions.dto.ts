import { z } from 'zod';
import { createZodDto } from '../../../../shared/http/create-zod-dto';

const MAX_REFRESH_TOKEN_LENGTH = 512;

export class ListOpenSessionsRequestDto extends createZodDto(
  z.strictObject({ refreshToken: z.string().min(1).max(MAX_REFRESH_TOKEN_LENGTH) }),
) {}

export class OpenSessionParamsDto extends createZodDto(z.strictObject({ sessionId: z.uuid() })) {}

export class OpenSessionsResponseDto extends createZodDto(
  z.strictObject({
    sessions: z.array(
      z.strictObject({
        id: z.uuid(),
        deviceName: z.string().nullable(),
        startedAt: z.iso.datetime(),
        lastActiveAt: z.iso.datetime(),
        isCurrent: z.boolean(),
      }),
    ),
  }),
) {}
