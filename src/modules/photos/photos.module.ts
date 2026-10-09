import { Global, Module } from '@nestjs/common';
import { FileStorageModule } from '../content/file-storage.module';
import { PhotoFileKeeper } from './application/photo-file-keeper';
import { PhotoUrlSigner } from './application/photo-url-signer';
import {
  RemoveMemberPhotoUseCase,
  RemoveMyPhotoUseCase,
  SetMyPhotoUseCase,
} from './application/photo.use-cases';
import { PHOTO_REPOSITORY } from './application/ports/photo.repository';
import { MemberPhotoController } from './http/member-photo.controller';
import { MyPhotoController } from './http/my-photo.controller';
import { PrismaPhotoRepository } from './infrastructure/prisma-photo.repository';

/** Fotos de perfil. Global: casi cualquier listado de personas firma el enlace de su foto. */
@Global()
@Module({
  imports: [FileStorageModule],
  controllers: [MyPhotoController, MemberPhotoController],
  providers: [
    PhotoUrlSigner,
    PhotoFileKeeper,
    SetMyPhotoUseCase,
    RemoveMyPhotoUseCase,
    RemoveMemberPhotoUseCase,
    { provide: PHOTO_REPOSITORY, useClass: PrismaPhotoRepository },
  ],
  exports: [PhotoUrlSigner, PhotoFileKeeper],
})
export class PhotosModule {}
