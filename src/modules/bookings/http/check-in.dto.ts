import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { bookingShape } from './booking.dto';

const MAX_QR_CONTENT_LENGTH = 2000;

export class CheckInCodeResponseDto extends createZodDto(
  z.strictObject({
    /** Lo que debe codificar el QR (`yoclick:checkin:<jwt>`). La app no lo interpreta ni lo firma. */
    qrContent: z.string(),
    /** Pasada esta hora el código ya no vale: la app lo renueva antes. */
    expiresAt: z.iso.datetime(),
  }),
) {}

export class CheckInRequestDto extends createZodDto(
  z.strictObject({ qrContent: z.string().min(1).max(MAX_QR_CONTENT_LENGTH) }),
) {}

export class CheckInResponseDto extends createZodDto(
  z.strictObject({
    clientFullName: z.string(),
    checkedInAt: z.iso.datetime(),
    /** `false` si esa llegada ya estaba registrada (repetir el escaneo no falla). */
    isFirstCheckIn: z.boolean(),
    booking: z.strictObject(bookingShape),
  }),
) {}
