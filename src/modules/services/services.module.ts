import { Module } from '@nestjs/common';
import { SERVICE_REPOSITORY } from './application/ports/service.repository';
import {
  ArchiveServiceUseCase,
  CreateServiceUseCase,
  ListServicesUseCase,
  ServicePhotoSigner,
  UpdateServiceUseCase,
} from './application/service.use-cases';
import { ServicesController } from './http/services.controller';
import { PrismaServiceRepository } from './infrastructure/prisma-service.repository';

@Module({
  controllers: [ServicesController],
  providers: [
    ListServicesUseCase,
    ServicePhotoSigner,
    CreateServiceUseCase,
    UpdateServiceUseCase,
    ArchiveServiceUseCase,
    { provide: SERVICE_REPOSITORY, useClass: PrismaServiceRepository },
  ],
})
export class ServicesModule {}
