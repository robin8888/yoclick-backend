import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type StaffProfileStatusName } from '../../../team-profiles/domain/profile-rules';

export interface ServiceStaffMember {
  readonly membershipId: string;
  readonly fullName: string;
  readonly photoKey: string | null;
  /** Estado del perfil profesional; `null` si todavía no tiene. La clientela solo ve fotos si está publicado. */
  readonly profileStatus: StaffProfileStatusName | null;
  readonly galleryPhotos: readonly { readonly id: string; readonly key: string }[];
}

/** Un servicio tal y como lo ve la app. */
export interface ServiceScheduleView {
  readonly id: string;
  /** 1 = lunes … 7 = domingo. */
  readonly weekday: number;
  /** Hora local del centro, `HH:MM`. */
  readonly startsAtTime: string;
  readonly endsAtTime: string;
  readonly room: { readonly id: string; readonly name: string } | null;
  readonly teacherName: string;
}

export interface ServiceView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: 'individual';
  /** Solo en privado, solo en grupo o de las dos formas. La clientela no elige el modo. */
  readonly mode: 'private' | 'group' | 'both';
  readonly durationMinutes: number;
  readonly priceCents: number | null;
  readonly color: string | null;
  readonly bookingWindowDays: number;
  readonly minNoticeMinutes: number;
  readonly isVisible: boolean;
  /** Sala o recurso donde se da; `null` = sin sala fija. */
  readonly room: { readonly id: string; readonly name: string } | null;
  /** Si el centro ya le ha puesto horario (con su sala y profesor): hasta entonces no se puede reservar. */
  readonly hasSchedule: boolean;
  /** Sus horarios semanales activos, con la sala y quien los da. */
  readonly schedules: readonly ServiceScheduleView[];
  readonly staff: readonly ServiceStaffMember[];
}

export interface NewService {
  readonly name: string;
  readonly description: string | null;
  readonly mode: 'private' | 'group' | 'both' | undefined;
  readonly durationMinutes: number;
  readonly priceCents: number | null;
  readonly color: string | null;
  readonly bookingWindowDays: number | undefined;
  readonly minNoticeMinutes: number | undefined;
  readonly isVisible: boolean | undefined;
  readonly roomId: string | null;
  readonly staffMembershipIds: readonly string[];
}

/** Solo lo enviado cambia; `null` sí es un valor (borra descripción, precio o color). */
export interface ServicePatch {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly mode?: 'private' | 'group' | 'both' | undefined;
  readonly durationMinutes?: number | undefined;
  readonly priceCents?: number | null | undefined;
  readonly color?: string | null | undefined;
  readonly bookingWindowDays?: number | undefined;
  readonly minNoticeMinutes?: number | undefined;
  readonly isVisible?: boolean | undefined;
  readonly roomId?: string | null | undefined;
  readonly staffMembershipIds?: readonly string[] | undefined;
}

export type ServiceWriteOutcome =
  | { readonly kind: 'saved'; readonly service: ServiceView }
  /** Alguna de las personas indicadas no es del equipo activo de este centro. */
  | { readonly kind: 'unknown_staff' }
  /** La sala no existe, está archivada o es de otro centro. */
  | { readonly kind: 'unknown_room' }
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
