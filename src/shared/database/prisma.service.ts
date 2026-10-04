import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { type Environment } from '../config/environment.schema';

/**
 * Toda sesión trabaja en UTC. El adaptador de Prisma envía las fechas como hora UTC SIN indicar la
 * zona, y PostgreSQL las interpreta en la zona de la sesión: con la del servidor (por ejemplo
 * Europe/Madrid) todo lo guardado quedaría desplazado horas respecto a `now()`, y una caducidad
 * calculada en la aplicación no coincidiría con la que ve la base de datos.
 */
const SESSION_TIME_ZONE_OPTION = '-c timezone=UTC';

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
        options: SESSION_TIME_ZONE_OPTION,
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
