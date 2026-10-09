import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../shared/config/environment.schema';
import { ContentPresenter } from './application/content-presenter';
import {
  AddDocumentUseCase,
  AddVideoContentUseCase,
  AssignContentUseCase,
  GetMyContentUseCase,
  ListContentUseCase,
  ListMyContentUseCase,
  RemoveContentUseCase,
  UpdateContentUseCase,
} from './application/content.use-cases';
import { CONTENT_REPOSITORY } from './application/ports/content.repository';
import { FILE_STORAGE, type FileStorage } from './application/ports/file-storage';
import { ContentAssignmentsController } from './http/content-assignments.controller';
import { ContentLibraryController } from './http/content-library.controller';
import { ContentUploadsController } from './http/content-uploads.controller';
import { MyContentController } from './http/my-content.controller';
import { BunnyFileStorage } from './infrastructure/bunny-file-storage';
import { FakeFileStorage } from './infrastructure/fake-file-storage';
import { PrismaContentRepository } from './infrastructure/prisma-content.repository';

function createFileStorage(configService: ConfigService<Environment, true>): FileStorage {
  if (configService.get('FILE_STORAGE_PROVIDER', { infer: true }) !== 'bunny') {
    return new FakeFileStorage();
  }
  // El esquema de entorno ya exige estos tres valores con FILE_STORAGE_PROVIDER=bunny.
  const read = (
    name: 'BUNNY_STORAGE_ZONE' | 'BUNNY_STORAGE_API_KEY' | 'BUNNY_STORAGE_CDN_HOSTNAME',
  ): string => configService.get(name, { infer: true });
  return new BunnyFileStorage({
    zone: read('BUNNY_STORAGE_ZONE'),
    apiKey: read('BUNNY_STORAGE_API_KEY'),
    storageHost: configService.get('BUNNY_STORAGE_HOST', { infer: true }),
    cdnHostname: read('BUNNY_STORAGE_CDN_HOSTNAME'),
    tokenKey: configService.get('BUNNY_STORAGE_TOKEN_KEY', { infer: true }),
    isTokenAuthEnabled:
      configService.get('BUNNY_STORAGE_TOKEN_AUTH', { infer: true }) === 'enabled',
  });
}

/** La biblioteca de contenido del centro: vídeos (en Bunny Stream) y PDF (en Bunny Storage). */
@Module({
  controllers: [
    ContentLibraryController,
    ContentAssignmentsController,
    ContentUploadsController,
    MyContentController,
  ],
  providers: [
    { provide: FILE_STORAGE, inject: [ConfigService], useFactory: createFileStorage },
    { provide: CONTENT_REPOSITORY, useClass: PrismaContentRepository },
    ContentPresenter,
    ListContentUseCase,
    AddDocumentUseCase,
    AddVideoContentUseCase,
    UpdateContentUseCase,
    AssignContentUseCase,
    RemoveContentUseCase,
    ListMyContentUseCase,
    GetMyContentUseCase,
  ],
})
export class ContentModule {}
