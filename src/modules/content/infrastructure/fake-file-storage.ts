import { MILLISECONDS_PER_HOUR } from '../../../shared/time/time-units';
import { type DocumentDownloadLink, type FileStorage } from '../application/ports/file-storage';

const FAKE_HOST = 'https://fake-files.invalid';

/** Para desarrollo y tests: guarda los ficheros en memoria y da enlaces a un dominio que no existe. */
export class FakeFileStorage implements FileStorage {
  readonly files = new Map<string, Buffer>();

  putFile(request: { readonly key: string; readonly bytes: Buffer }): Promise<void> {
    this.files.set(request.key, request.bytes);
    return Promise.resolve();
  }

  deleteFile(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }

  signDownload(key: string): DocumentDownloadLink {
    return {
      url: `${FAKE_HOST}/${key}`,
      expiresAt: new Date(Date.now() + MILLISECONDS_PER_HOUR),
    };
  }
}
