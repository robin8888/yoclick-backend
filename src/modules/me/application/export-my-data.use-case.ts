import { Inject, Injectable } from '@nestjs/common';
import { ReauthenticationChecker } from '../../auth/application/reauthentication.checker';
import {
  PROFILE_REPOSITORY,
  type ConsentState,
  type MyMembership,
  type Profile,
  type ProfileRepository,
} from './ports/profile.repository';

export interface PersonalDataExport {
  readonly exportedAt: Date;
  readonly profile: Profile;
  readonly memberships: readonly MyMembership[];
  readonly consentHistory: readonly ConsentState[];
}

/**
 * Derecho de acceso y portabilidad (RGPD arts. 15 y 20): todo lo que la plataforma guarda de la persona,
 * en JSON. Exige la contraseña (SEC-12): un token robado no debe poder llevarse los datos personales.
 *
 * Nunca incluye el hash de la contraseña ni secretos. Se entrega en la respuesta y no por un enlace
 * enviado al correo; los datos de reservas y pagos se añaden cuando existan esos módulos.
 */
@Injectable()
export class ExportMyDataUseCase {
  constructor(
    private readonly reauthenticationChecker: ReauthenticationChecker,
    @Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository,
  ) {}

  async execute(userId: string, password: string): Promise<PersonalDataExport> {
    await this.reauthenticationChecker.assertPasswordIsCorrect(userId, password);

    const [profile, memberships, consentHistory] = await Promise.all([
      this.profiles.getProfile(userId),
      this.profiles.listMemberships(userId),
      this.profiles.listConsentHistory(userId),
    ]);
    if (!profile) throw new Error('The account vanished during its own export');

    return { exportedAt: new Date(), profile, memberships, consentHistory };
  }
}
