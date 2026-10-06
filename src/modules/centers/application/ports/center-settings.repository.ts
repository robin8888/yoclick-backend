import { type ActorContext } from '../../../../shared/tenancy/actor-context';
import { type OpeningHours } from '../../domain/opening-hours';

export interface Holiday {
  readonly date: string;
  readonly label: string;
}

export interface CancelPolicy {
  /** Horas de antelación hasta las que se puede cancelar sin consecuencias. */
  readonly freeCancellationHours: number;
  /** Si cancelar tarde gasta la sesión del bono. */
  readonly lateCancellationConsumesCredit: boolean;
}

export interface CenterSettings {
  readonly id: string;
  readonly updatedAt: Date;
  readonly slug: string;
  readonly name: string;
  readonly sectorId: string;
  readonly brandColor: string;
  readonly timezone: string;
  readonly joinCode: string;
  readonly status: 'trial' | 'active' | 'past_due' | 'suspended';
  readonly isListed: boolean;
  readonly city: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly contactEmail: string | null;
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly taxAddress: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly openingHours: OpeningHours | null;
  readonly holidays: readonly Holiday[] | null;
  readonly cancelPolicy: CancelPolicy | null;
  readonly trialEndsAt: Date | null;
}

/** Solo lo que la administración puede cambiar. El slug, el código, el estado y el plan no están aquí. */
export interface CenterSettingsPatch {
  readonly name?: string | undefined;
  readonly sectorId?: string | undefined;
  readonly brandColor?: string | undefined;
  readonly timezone?: string | undefined;
  readonly isListed?: boolean | undefined;
  readonly city?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly contactEmail?: string | null | undefined;
  readonly legalName?: string | null | undefined;
  readonly taxId?: string | null | undefined;
  readonly taxAddress?: string | null | undefined;
  readonly latitude?: number | null | undefined;
  readonly longitude?: number | null | undefined;
  readonly openingHours?: OpeningHours | undefined;
  readonly holidays?: readonly Holiday[] | undefined;
  readonly cancelPolicy?: CancelPolicy | undefined;
}

export interface CenterSettingsRepository {
  find(actor: ActorContext): Promise<CenterSettings | null>;
  /**
   * Aplica el cambio solo si el centro sigue en la versión que se leyó (`expectedUpdatedAt`).
   * Devuelve `null` si otra persona lo modificó entretanto.
   */
  updateIfUnchanged(
    actor: ActorContext,
    expectedUpdatedAt: Date,
    patch: CenterSettingsPatch,
  ): Promise<CenterSettings | null>;
}

export const CENTER_SETTINGS_REPOSITORY = Symbol('CENTER_SETTINGS_REPOSITORY');
