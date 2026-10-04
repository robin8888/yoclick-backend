import { Controller, Get, Module } from '@nestjs/common';
import { CurrentActor } from '../../src/shared/auth/decorators/current-actor.decorator';
import { CurrentUserId } from '../../src/shared/auth/decorators/current-user-id.decorator';
import { Public } from '../../src/shared/auth/decorators/public.decorator';
import { Roles } from '../../src/shared/auth/decorators/roles.decorator';
import { UserScoped } from '../../src/shared/auth/decorators/user-scoped.decorator';
import { type ActorContext } from '../../src/shared/tenancy/actor-context';

/** Solo existe en tests: una ruta de cada tipo de política, y una que no declara ninguna. */
@Controller('probe-guards')
class GuardProbeController {
  @Get('public')
  @Public()
  openToEveryone(): { open: true } {
    return { open: true };
  }

  @Get('user')
  @UserScoped()
  reportAuthenticatedUser(@CurrentUserId() userId: string): { userId: string } {
    return { userId };
  }

  @Get('staff-area')
  @Roles('owner', 'admin', 'staff')
  reportActorInStaffArea(@CurrentActor() actor: ActorContext): { centerId: string; role: string } {
    return { centerId: actor.centerId, role: actor.role };
  }

  @Get('admin-area')
  @Roles('owner', 'admin')
  reportActorInAdminArea(@CurrentActor() actor: ActorContext): { role: string } {
    return { role: actor.role };
  }

  @Get('forgotten-policy')
  forgotToDeclareAccess(): { reached: true } {
    return { reached: true };
  }
}

@Module({ controllers: [GuardProbeController] })
export class GuardProbeModule {}
