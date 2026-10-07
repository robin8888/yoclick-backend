import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../shared/config/environment.schema';
import { VIDEO_HOSTING, type VideoHosting } from './application/ports/video-hosting';
import { VIDEO_REPOSITORY } from './application/ports/video.repository';
import { VideoPresenter } from './application/video-presenter';
import {
  DeleteVideoUseCase,
  GetVideoUseCase,
  ListTeamProfilesUseCase,
  ReviewVideoUseCase,
  StartVideoUploadUseCase,
} from './application/video.use-cases';
import { TeamVideoProfilesController } from './http/team-video-profiles.controller';
import { VideoUploadsController } from './http/video-uploads.controller';
import { BunnyStreamVideoHosting } from './infrastructure/bunny-stream-video-hosting';
import { FakeVideoHosting } from './infrastructure/fake-video-hosting';
import { PrismaVideoRepository } from './infrastructure/prisma-video.repository';

function createVideoHosting(configService: ConfigService<Environment, true>): VideoHosting {
  if (configService.get('VIDEO_PROVIDER', { infer: true }) !== 'bunny') {
    return new FakeVideoHosting();
  }
  // El esquema de entorno ya exige estos cuatro valores con VIDEO_PROVIDER=bunny.
  const read = (
    name:
      | 'BUNNY_STREAM_LIBRARY_ID'
      | 'BUNNY_STREAM_API_KEY'
      | 'BUNNY_STREAM_TOKEN_KEY'
      | 'BUNNY_STREAM_CDN_HOSTNAME',
  ): string => configService.get(name, { infer: true });
  return new BunnyStreamVideoHosting({
    libraryId: read('BUNNY_STREAM_LIBRARY_ID'),
    apiKey: read('BUNNY_STREAM_API_KEY'),
    tokenKey: read('BUNNY_STREAM_TOKEN_KEY'),
    cdnHostname: read('BUNNY_STREAM_CDN_HOSTNAME'),
  });
}

/** Global: rutinas y perfiles del equipo necesitan firmar la reproducción sin importar este módulo. */
@Global()
@Module({
  controllers: [VideoUploadsController, TeamVideoProfilesController],
  providers: [
    { provide: VIDEO_HOSTING, inject: [ConfigService], useFactory: createVideoHosting },
    { provide: VIDEO_REPOSITORY, useClass: PrismaVideoRepository },
    VideoPresenter,
    StartVideoUploadUseCase,
    GetVideoUseCase,
    DeleteVideoUseCase,
    ReviewVideoUseCase,
    ListTeamProfilesUseCase,
  ],
  exports: [VideoPresenter, VIDEO_HOSTING],
})
export class VideosModule {}
