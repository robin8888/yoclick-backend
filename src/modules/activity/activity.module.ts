import { Global, Module } from '@nestjs/common';
import { ActivityRecorder } from './application/activity-recorder';
import { ListActivityUseCase } from './application/list-activity.use-case';
import { ActivityController } from './http/activity.controller';

/** Global: cualquier módulo del centro puede anotar lo que ocurre sin importar este módulo. */
@Global()
@Module({
  controllers: [ActivityController],
  providers: [ActivityRecorder, ListActivityUseCase],
  exports: [ActivityRecorder],
})
export class ActivityModule {}
