import { Inject, Injectable } from '@nestjs/common';
import {
  PROFILE_REPOSITORY,
  type MyMembership,
  type ProfileRepository,
} from './ports/profile.repository';

/** "Mis centros": los centros a los que pertenece la persona, con la marca para pintarlos. */
@Injectable()
export class ListMyMembershipsUseCase {
  constructor(@Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository) {}

  async execute(userId: string): Promise<MyMembership[]> {
    return this.profiles.listMemberships(userId);
  }
}
