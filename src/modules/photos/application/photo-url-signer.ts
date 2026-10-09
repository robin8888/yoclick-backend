import { Inject, Injectable } from '@nestjs/common';
import { FILE_STORAGE, type FileStorage } from '../../content/application/ports/file-storage';

/** El mismo registro, con la ruta del almacén cambiada por el enlace firmado que ve la app. */
export type WithPhotoUrl<TRecord extends { photoKey: string | null }> = Omit<
  TRecord,
  'photoKey'
> & { readonly photoUrl: string | null };

export interface GalleryPhotoRecord {
  readonly id: string;
  readonly key: string;
}

/** Convierte las rutas del almacén en enlaces de descarga firmados, que son lo único que sale de la API. */
@Injectable()
export class PhotoUrlSigner {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  sign(key: string | null): string | null {
    return key === null ? null : this.storage.signDownload(key).url;
  }

  attachPhotoUrl<TRecord extends { photoKey: string | null }>(
    record: TRecord,
  ): WithPhotoUrl<TRecord> {
    const { photoKey, ...rest } = record;
    return { ...rest, photoUrl: this.sign(photoKey) };
  }

  signGallery(photos: readonly GalleryPhotoRecord[]): { id: string; url: string }[] {
    return photos.map(({ id, key }) => ({ id, url: this.storage.signDownload(key).url }));
  }
}
