import { Inject, Injectable } from '@nestjs/common';
import { LEGAL_DOCUMENT_VERSIONS } from '../../auth/domain/legal-document-versions';
import {
  PROFILE_REPOSITORY,
  type ChangeableConsentKind,
  type ConsentState,
  type ProfileRepository,
} from './ports/profile.repository';

@Injectable()
export class SetMyConsentUseCase {
  constructor(@Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository) {}

  /**
   * Solo se pueden cambiar los consentimientos opcionales. Privacidad y términos son condición de tener
   * la cuenta (se retiran eliminándola); salud y los de menores dependen de un centro y llevan su
   * propio flujo con reautenticación.
   */
  async execute(
    userId: string,
    change: { kind: ChangeableConsentKind; isGranted: boolean },
  ): Promise<ConsentState[]> {
    await this.profiles.recordConsent(userId, {
      kind: change.kind,
      isGranted: change.isGranted,
      version: LEGAL_DOCUMENT_VERSIONS[change.kind],
    });
    return this.profiles.listLatestConsents(userId);
  }
}
