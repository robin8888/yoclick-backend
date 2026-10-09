import { Inject, Injectable } from '@nestjs/common';
import { PhotoUrlSigner, type WithPhotoUrl } from '../../photos/application/photo-url-signer';
import {
  PROFILE_REPOSITORY,
  type MyMembership,
  type ProfileRepository,
} from './ports/profile.repository';

/** "Mis centros": los centros a los que pertenece la persona, con la marca para pintarlos. */
@Injectable()
export class ListMyMembershipsUseCase {
  constructor(
    @Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository,
    private readonly urlSigner: PhotoUrlSigner,
  ) {}

  async execute(userId: string): Promise<WithPhotoUrl<MyMembership>[]> {
    const memberships = await this.profiles.listMemberships(userId);
    return memberships.map((membership) => this.urlSigner.attachPhotoUrl(membership));
  }
}
