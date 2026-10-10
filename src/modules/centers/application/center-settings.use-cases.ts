import { Inject, Injectable } from '@nestjs/common';
import { assertIfMatchPrecondition, buildEtag } from '../../../shared/concurrency/etag';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  CENTER_SETTINGS_REPOSITORY,
  type CenterSettings,
  type CenterSettingsPatch,
  type CenterSettingsRepository,
} from './ports/center-settings.repository';

export interface VersionedCenterSettings {
  readonly settings: CenterSettings;
  readonly etag: string;
}

function withEtag(settings: CenterSettings): VersionedCenterSettings {
  return { settings, etag: buildEtag(settings) };
}

const APPEARANCE_FIELDS = ['backgroundColor', 'backgroundColorEnd', 'hiveColor'] as const;

/** Quitar un color siempre se puede; elegir uno exige el plan Premium. */
function assertPremiumForAppearanceChange(
  current: CenterSettings,
  patch: CenterSettingsPatch,
): void {
  const isSettingAColor = APPEARANCE_FIELDS.some(
    (field) => patch[field] !== undefined && patch[field] !== null,
  );
  if (isSettingAColor && !current.canCustomizeAppearance) {
    throw new DomainError('PREMIUM_APPEARANCE_NOT_INCLUDED', HTTP_STATUS.forbidden);
  }
}

/** El segundo color de un degradado no tiene sentido sin el primero. */
function assertGradientKeepsItsStartColor(
  current: CenterSettings,
  patch: CenterSettingsPatch,
): void {
  const startColor =
    patch.backgroundColor === undefined ? current.backgroundColor : patch.backgroundColor;
  const endColor =
    patch.backgroundColorEnd === undefined ? current.backgroundColorEnd : patch.backgroundColorEnd;
  if (endColor !== null && startColor === null) {
    throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest, [
      { path: 'backgroundColorEnd', code: 'requires_background_color' },
    ]);
  }
}

/** Un centro ajeno y uno inexistente son lo mismo para quien pregunta: 404. */
function assertRouteTargetsActorCenter(actor: ActorContext, routeCenterId: string): void {
  if (routeCenterId !== actor.centerId) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
}

@Injectable()
export class GetCenterSettingsUseCase {
  constructor(
    @Inject(CENTER_SETTINGS_REPOSITORY) private readonly settings: CenterSettingsRepository,
  ) {}

  async execute(actor: ActorContext, routeCenterId: string): Promise<VersionedCenterSettings> {
    assertRouteTargetsActorCenter(actor, routeCenterId);
    const current = await this.settings.find(actor);
    if (!current) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    return withEtag(current);
  }
}

export interface UpdateCenterSettingsRequest {
  readonly actor: ActorContext;
  readonly routeCenterId: string;
  readonly ifMatchHeader: string | undefined;
  readonly patch: CenterSettingsPatch;
}

/**
 * Edita los datos del centro con concurrencia optimista: exige `If-Match` con la versión que la
 * persona vio y responde 412 si otra la cambió antes, en lugar de pisar su cambio.
 */
@Injectable()
export class UpdateCenterSettingsUseCase {
  constructor(
    @Inject(CENTER_SETTINGS_REPOSITORY) private readonly settings: CenterSettingsRepository,
  ) {}

  async execute(request: UpdateCenterSettingsRequest): Promise<VersionedCenterSettings> {
    const { actor, routeCenterId, ifMatchHeader, patch } = request;
    assertRouteTargetsActorCenter(actor, routeCenterId);

    const current = await this.settings.find(actor);
    if (!current) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
    assertIfMatchPrecondition(ifMatchHeader, buildEtag(current));
    assertPremiumForAppearanceChange(current, patch);
    assertGradientKeepsItsStartColor(current, patch);

    const updated = await this.settings.updateIfUnchanged(actor, current.updatedAt, patch);
    if (!updated) throw new DomainError('PRECONDITION_FAILED', HTTP_STATUS.preconditionFailed);
    return withEtag(updated);
  }
}
