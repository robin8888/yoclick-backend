import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../database/tenant-prisma.service';
import { resolveCenterModules, type CenterModules } from './center-modules';

/** Lee qué módulos tiene encendidos un centro. */
@Injectable()
export class CenterModulesFinder {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  /** Un centro que no existe se trata como uno con todo encendido: la ruta responderá lo suyo. */
  async find(centerId: string): Promise<CenterModules> {
    const center = await this.tenantPrismaService.runInCenterLookupContext({ centerId }, (client) =>
      client.center.findUnique({ where: { id: centerId }, select: { disabledModules: true } }),
    );
    return resolveCenterModules(center?.disabledModules ?? []);
  }
}
