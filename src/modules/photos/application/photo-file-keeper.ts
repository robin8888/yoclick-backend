import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { FILE_STORAGE, type FileStorage } from '../../content/application/ports/file-storage';
import { decidePhotoUpload, type PhotoFormat } from '../domain/photo-rules';

/** Guarda y descarta ficheros de foto; lo que sobra en el almacén solo cuesta dinero, pero nunca debe romper una petición. */
@Injectable()
export class PhotoFileKeeper {
  private readonly logger = new Logger(PhotoFileKeeper.name);

  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  /** Comprueba por los bytes (no por lo que diga el móvil) que es una imagen admitida y de tamaño razonable. */
  assertAcceptable(bytes: Buffer): PhotoFormat {
    const decision = decidePhotoUpload(bytes);
    if (decision.kind === 'not_an_image') {
      throw new DomainError('PHOTO_NOT_IMAGE', HTTP_STATUS.badRequest);
    }
    if (decision.kind === 'too_large') {
      throw new DomainError('PHOTO_TOO_LARGE', HTTP_STATUS.payloadTooLarge);
    }
    return decision.format;
  }

  newPhotoId(): string {
    return generateUuidV7();
  }

  save(request: { readonly key: string; readonly bytes: Buffer }): Promise<void> {
    return this.storage.putFile(request);
  }

  async discard(key: string | null): Promise<void> {
    if (key === null) return;
    try {
      await this.storage.deleteFile(key);
    } catch (error) {
      this.logger.warn(`Could not delete ${key} from the file storage`, error);
    }
  }
}
