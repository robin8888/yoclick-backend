import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../shared/config/environment.schema';
import { FILE_STORAGE, type FileStorage } from './application/ports/file-storage';
import { BunnyFileStorage } from './infrastructure/bunny-file-storage';
import { FakeFileStorage } from './infrastructure/fake-file-storage';

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

/** El almacén de ficheros (PDF y fotos), uno para toda la API: global para que cualquier módulo firme enlaces. */
@Global()
@Module({
  providers: [{ provide: FILE_STORAGE, inject: [ConfigService], useFactory: createFileStorage }],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}
