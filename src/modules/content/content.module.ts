import { Module } from '@nestjs/common';
import { ContentPresenter } from './application/content-presenter';
import {
  AddDocumentUseCase,
  AddImageUseCase,
  AddVideoContentUseCase,
  AssignContentUseCase,
  GetMyContentUseCase,
  ListContentUseCase,
  ListMyContentUseCase,
  RemoveContentUseCase,
  StoreContentFileUseCase,
  UpdateContentUseCase,
} from './application/content.use-cases';
import { CONTENT_REPOSITORY } from './application/ports/content.repository';
import { FileStorageModule } from './file-storage.module';
import { ContentAssignmentsController } from './http/content-assignments.controller';
import { ContentLibraryController } from './http/content-library.controller';
import { ContentUploadsController } from './http/content-uploads.controller';
import { MyContentController } from './http/my-content.controller';
import { PrismaContentRepository } from './infrastructure/prisma-content.repository';

/** La biblioteca de contenido del centro: vídeos (en Bunny Stream), PDF e imágenes (en Bunny Storage). */
@Module({
  imports: [FileStorageModule],
  controllers: [
    ContentLibraryController,
    ContentAssignmentsController,
    ContentUploadsController,
    MyContentController,
  ],
  providers: [
    { provide: CONTENT_REPOSITORY, useClass: PrismaContentRepository },
    ContentPresenter,
    ListContentUseCase,
    StoreContentFileUseCase,
    AddDocumentUseCase,
    AddImageUseCase,
    AddVideoContentUseCase,
    UpdateContentUseCase,
    AssignContentUseCase,
    RemoveContentUseCase,
    ListMyContentUseCase,
    GetMyContentUseCase,
  ],
})
export class ContentModule {}
