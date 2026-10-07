import { Body, Controller, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { v7 as generateUuidV7 } from 'uuid';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { TenantPrismaService } from '../../../shared/database/tenant-prisma.service';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RegisterPushDeviceRequestDto, UnregisterPushDeviceRequestDto } from './push-devices.dto';

/** Un móvil que se registra, un móvil que se da de baja: así la persona recibe (o deja de recibir) avisos. */
const MAX_DEVICES_PER_USER = 10;

@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('me/push-token')
@UserScoped()
export class PushDevicesController {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'me_register_push_device',
    summary:
      'Registra este móvil para recibir avisos push. Si el token ya era de otra cuenta (otra persona usó antes el móvil), pasa a esta.',
  })
  @ApiNoContentResponse()
  async register(
    @CurrentUserId() userId: string,
    @Body() body: RegisterPushDeviceRequestDto,
  ): Promise<void> {
    await this.tenantPrismaService.runInUserContext(userId, async (client) => {
      await client.pushDevice.upsert({
        where: { token: body.token },
        create: { id: generateUuidV7(), userId, token: body.token, platform: body.platform },
        update: { userId, platform: body.platform, lastSeenAt: new Date() },
      });
      const stale = await client.pushDevice.findMany({
        where: { userId },
        orderBy: { lastSeenAt: 'desc' },
        skip: MAX_DEVICES_PER_USER,
        select: { id: true },
      });
      if (stale.length > 0) {
        await client.pushDevice.deleteMany({ where: { id: { in: stale.map(({ id }) => id) } } });
      }
    });
  }

  @Post('unregister')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'me_unregister_push_device',
    summary: 'Da de baja este móvil: deja de recibir avisos push (al cerrar sesión).',
  })
  @ApiNoContentResponse()
  async unregister(
    @CurrentUserId() userId: string,
    @Body() body: UnregisterPushDeviceRequestDto,
  ): Promise<void> {
    await this.tenantPrismaService.runInUserContext(userId, (client) =>
      client.pushDevice.deleteMany({ where: { token: body.token, userId } }),
    );
  }
}
