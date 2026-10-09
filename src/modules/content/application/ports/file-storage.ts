export interface DocumentDownloadLink {
  readonly url: string;
  readonly expiresAt: Date;
}

/** El almacén de ficheros donde viven los PDF. La base de datos solo guarda su ruta. */
export interface FileStorage {
  putFile(request: { readonly key: string; readonly bytes: Buffer }): Promise<void>;
  deleteFile(key: string): Promise<void>;
  signDownload(key: string): DocumentDownloadLink;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');
