import { Inject, Injectable } from '@nestjs/common';
import { accountGoneError } from './account-gone.error';
import {
  PROFILE_REPOSITORY,
  type Profile,
  type ProfilePatch,
  type ProfileRepository,
} from './ports/profile.repository';

@Injectable()
export class UpdateMyProfileUseCase {
  constructor(@Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository) {}

  /** El correo no se cambia aquí: exigiría confirmar el nuevo buzón y es un flujo propio. */
  async execute(userId: string, patch: ProfilePatch): Promise<Profile> {
    const updated = await this.profiles.updateProfile(userId, patch);
    if (!updated) throw accountGoneError();
    return updated;
  }
}
