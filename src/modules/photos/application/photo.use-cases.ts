import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { buildAvatarKey } from '../domain/photo-rules';
import { PhotoFileKeeper } from './photo-file-keeper';
import { PhotoUrlSigner } from './photo-url-signer';
import { PHOTO_REPOSITORY, type PhotoRepository } from './ports/photo.repository';

@Injectable()
export class SetMyPhotoUseCase {
  constructor(
    @Inject(PHOTO_REPOSITORY) private readonly photos: PhotoRepository,
    private readonly files: PhotoFileKeeper,
    private readonly urlSigner: PhotoUrlSigner,
  ) {}

  /** Cambia la foto de perfil; la anterior se borra del almacén una vez guardada la nueva. */
  async execute(request: { userId: string; bytes: Buffer }): Promise<string> {
    const format = this.files.assertAcceptable(request.bytes);
    const key = buildAvatarKey({
      userId: request.userId,
      photoId: this.files.newPhotoId(),
      format,
    });
    await this.files.save({ key, bytes: request.bytes });
    const replaced = await this.replaceOrDiscard(request.userId, key);
    if (replaced === null) {
      await this.files.discard(key);
      throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    }
    await this.files.discard(replaced.previousKey);
    return this.urlSigner.sign(key) ?? '';
  }

  /** Un fichero que sobra en el almacén solo cuesta dinero: si no se pudo guardar, se borra. */
  private async replaceOrDiscard(
    userId: string,
    key: string,
  ): Promise<{ previousKey: string | null } | null> {
    try {
      return await this.photos.replaceAvatar(userId, key);
    } catch (error) {
      await this.files.discard(key);
      throw error;
    }
  }
}

@Injectable()
export class RemoveMyPhotoUseCase {
  constructor(
    @Inject(PHOTO_REPOSITORY) private readonly photos: PhotoRepository,
    private readonly files: PhotoFileKeeper,
  ) {}

  async execute(userId: string): Promise<void> {
    await this.files.discard(await this.photos.removeAvatar(userId));
  }
}

@Injectable()
export class RemoveMemberPhotoUseCase {
  constructor(
    @Inject(PHOTO_REPOSITORY) private readonly photos: PhotoRepository,
    private readonly files: PhotoFileKeeper,
  ) {}

  async execute(actor: ActorContext, membershipId: string): Promise<void> {
    const removal = await this.photos.removeMemberAvatar(actor, membershipId);
    if (removal.kind === 'not_found') throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    await this.files.discard(removal.previousKey);
  }
}
