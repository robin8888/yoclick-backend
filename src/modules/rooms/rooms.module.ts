import { Module } from '@nestjs/common';
import { ROOM_REPOSITORY } from './application/ports/room.repository';
import {
  ArchiveRoomUseCase,
  CreateRoomUseCase,
  ListRoomsUseCase,
} from './application/room.use-cases';
import { RoomsController } from './http/rooms.controller';
import { PrismaRoomRepository } from './infrastructure/prisma-room.repository';

@Module({
  controllers: [RoomsController],
  providers: [
    ListRoomsUseCase,
    CreateRoomUseCase,
    ArchiveRoomUseCase,
    { provide: ROOM_REPOSITORY, useClass: PrismaRoomRepository },
  ],
})
export class RoomsModule {}
