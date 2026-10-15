import { z } from 'zod';
import { createZodDto } from '../../../shared/http/create-zod-dto';

export class ChildRouteParamsDto extends createZodDto(
  z.strictObject({ centerId: z.uuid(), childMembershipId: z.uuid() }),
) {}

export class GuardianRouteParamsDto extends createZodDto(
  z.strictObject({
    centerId: z.uuid(),
    childMembershipId: z.uuid(),
    guardianMembershipId: z.uuid(),
  }),
) {}

export class CenterRouteParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

export class LinkGuardianRequestDto extends createZodDto(
  z.strictObject({ guardianMembershipId: z.uuid() }),
) {}

export class GuardianListResponseDto extends createZodDto(
  z.strictObject({
    guardians: z.array(
      z.strictObject({ membershipId: z.uuid(), fullName: z.string(), email: z.string() }),
    ),
  }),
) {}

export class MyChildrenResponseDto extends createZodDto(
  z.strictObject({
    children: z.array(
      z.strictObject({
        membershipId: z.uuid(),
        fullName: z.string(),
        photoUrl: z.string().nullable(),
        isMinor: z.boolean(),
        upcomingBookings: z.array(
          z.strictObject({
            id: z.uuid(),
            serviceName: z.string(),
            startsAt: z.iso.datetime(),
            teacherName: z.string(),
          }),
        ),
        /** Clases que le quedan en sus bonos vigentes. */
        remainingSessions: z.number().int(),
      }),
    ),
  }),
) {}
