import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';
import { addRandomSuffix, generateJoinCode, slugifyCenterName } from '../domain/center-identifiers';
import {
  CENTER_CREATION_REPOSITORY,
  type CenterCreationRepository,
} from './ports/center-creation.repository';

export const TRIAL_DAYS = 14;
export const MAX_OWNED_CENTERS = 5;
const MAX_IDENTIFIER_ATTEMPTS = 5;

export interface CreateCenterRequest {
  readonly ownerUserId: string;
  readonly name: string;
  readonly sectorId: string;
  readonly brandColor: string;
  readonly city: string | null;
  readonly isListed: boolean;
}

export interface CreatedCenter {
  readonly centerId: string;
  readonly ownerMembershipId: string;
  readonly slug: string;
  readonly name: string;
  readonly sectorId: string;
  readonly brandColor: string;
  readonly isListed: boolean;
  readonly joinCode: string;
  readonly trialEndsAt: string;
  readonly logoUrl: string | null;
}

/**
 * Da de alta un centro en periodo de prueba, con quien lo crea como propietario. El slug y el
 * código de unión son únicos: si chocan con otro centro, se generan otros y se reintenta.
 */
@Injectable()
export class CreateCenterUseCase {
  constructor(
    @Inject(CENTER_CREATION_REPOSITORY) private readonly centers: CenterCreationRepository,
  ) {}

  async execute(request: CreateCenterRequest): Promise<CreatedCenter> {
    const centerId = generateUuidV7();
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * MILLISECONDS_PER_DAY);
    const baseSlug = slugifyCenterName(request.name);

    for (let attempt = 0; attempt < MAX_IDENTIFIER_ATTEMPTS; attempt += 1) {
      const slug = attempt === 0 ? baseSlug : addRandomSuffix(baseSlug);
      const joinCode = generateJoinCode();
      const result = await this.centers.createWithOwner(
        { id: centerId, slug, joinCode, trialEndsAt, ...pickCenterFields(request) },
        request.ownerUserId,
        MAX_OWNED_CENTERS,
      );

      if (result.kind === 'owner_limit_reached') {
        throw new DomainError('CENTER_LIMIT_REACHED', HTTP_STATUS.conflict);
      }
      if (result.kind === 'created') {
        return toCreatedCenter({ centerId, slug, joinCode, trialEndsAt, request, result });
      }
    }
    throw new Error('Could not find a free slug and join code for the new center');
  }
}

function pickCenterFields(request: CreateCenterRequest) {
  return {
    name: request.name,
    sectorId: request.sectorId,
    brandColor: request.brandColor,
    city: request.city,
    isListed: request.isListed,
  };
}

function toCreatedCenter(created: {
  centerId: string;
  slug: string;
  joinCode: string;
  trialEndsAt: Date;
  request: CreateCenterRequest;
  result: { ownerMembershipId: string };
}): CreatedCenter {
  return {
    centerId: created.centerId,
    ownerMembershipId: created.result.ownerMembershipId,
    slug: created.slug,
    name: created.request.name,
    sectorId: created.request.sectorId,
    brandColor: created.request.brandColor,
    isListed: created.request.isListed,
    joinCode: created.joinCode,
    trialEndsAt: created.trialEndsAt.toISOString(),
    logoUrl: null,
  };
}
