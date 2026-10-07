import { Module } from '@nestjs/common';
import { ImportClientsUseCase } from './application/import-clients.use-case';
import { CLIENT_IMPORT_REPOSITORY } from './application/ports/client-import.repository';
import {
  GetClientUseCase,
  ListClientsUseCase,
  UpdateClientUseCase,
} from './application/client.use-cases';
import {
  ArchiveGroupUseCase,
  CreateGroupUseCase,
  ListGroupsUseCase,
} from './application/group.use-cases';
import { CLIENT_REPOSITORY } from './application/ports/client.repository';
import { GROUP_REPOSITORY } from './application/ports/group.repository';
import { ClientsController } from './http/clients.controller';
import { GroupsController } from './http/groups.controller';
import { PrismaClientImportRepository } from './infrastructure/prisma-client-import.repository';
import { PrismaClientRepository } from './infrastructure/prisma-client.repository';
import { PrismaGroupRepository } from './infrastructure/prisma-group.repository';

@Module({
  controllers: [ClientsController, GroupsController],
  providers: [
    ListClientsUseCase,
    GetClientUseCase,
    UpdateClientUseCase,
    ImportClientsUseCase,
    ListGroupsUseCase,
    CreateGroupUseCase,
    ArchiveGroupUseCase,
    { provide: CLIENT_REPOSITORY, useClass: PrismaClientRepository },
    { provide: CLIENT_IMPORT_REPOSITORY, useClass: PrismaClientImportRepository },
    { provide: GROUP_REPOSITORY, useClass: PrismaGroupRepository },
  ],
})
export class ClientsModule {}
