import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

export class MemberPhotoRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), membershipId: z.uuid() }),
) {}

export class MyPhotoResponseDto extends createZodDto(
  z.strictObject({
    /** Enlace firmado y temporal: la app lo pide de nuevo cuando caduca. */
    photoUrl: z.string(),
  }),
) {}
