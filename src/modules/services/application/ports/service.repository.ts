import { type ActorContext } from '../../../../shared/tenancy/actor-context';

export interface ServiceStaffMember {
  readonly membershipId: string;
  readonly fullName: string;
}

/** Un servicio tal y como lo ve la app. */
export interface ServiceView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: 'individual';
  readonly durationMinutes: number;
  readonly priceCents: number | null;
  readonly color: string | null;
  readonly bookingWindowDays: number;
  readonly minNoticeMinutes: number;
  readonly isVisible: boolean;
  readonly staff: readonly ServiceStaffMember[];
}

export interface NewService {
  readonly name: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly priceCents: number | null;
  readonly color: string | null;
  readonly bookingWindowDays: number | undefined;
  readonly minNoticeMinutes: number | undefined;
  readonly isVisible: boolean | undefined;
  readonly staffMembershipIds: readonly string[];
}

/** Solo lo enviado cambia; `null` sí es un valor (borra descripción, precio o color). */
export interface ServicePatch {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly durationMinutes?: number | undefined;
  readonly priceCents?: number | null | undefined;
  readonly color?: string | null | undefined;
  readonly bookingWindowDays?: number | undefined;
  readonly minNoticeMinutes?: number | undefined;
  readonly isVisible?: boolean | undefined;
  readonly staffMembershipIds?: readonly string[] | undefined;
}

export type ServiceWriteOutcome =
  | { readonly kind: 'saved'; readonly service: ServiceView }
  /** Alguna de las personas indicadas no es del equipo activo de este centro. */
  | { readonly kind: 'unknown_staff' }
  | { readonly kind: 'not_found' };

export interface ServiceRepository {
  /** Servicios no archivados por orden de presentación; `onlyVisible` los acota a lo que ve la clientela. */
  listServices(
    actor: ActorContext,
    filter: { readonly onlyVisible: boolean },
  ): Promise<ServiceView[]>;
  createService(actor: ActorContext, newService: NewService): Promise<ServiceWriteOutcome>;
  updateService(
    actor: ActorContext,
    serviceId: string,
    patch: ServicePatch,
  ): Promise<ServiceWriteOutcome>;
  /** Archiva (no borra) un servicio no archivado. `false` si no existe o ya estaba archivado. */
  archiveService(actor: ActorContext, serviceId: string): Promise<boolean>;
}

export const SERVICE_REPOSITORY = Symbol('SERVICE_REPOSITORY');
