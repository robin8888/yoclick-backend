import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { type Environment } from '../config/environment.schema';

/**
 * Cliente global de Prisma, conectado con el rol yoclick_app (sin BYPASSRLS ni DDL).
 *
 * Solo debe usarlo `TenantPrismaService`. Los repositorios reciben el cliente de la
 * transacción con el contexto del centro ya fijado; una consulta hecha con este cliente
 * directamente no tiene contexto y la RLS no devuelve ninguna fila.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService<Environment, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: configService.get('DATABASE_URL', { infer: true }),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
