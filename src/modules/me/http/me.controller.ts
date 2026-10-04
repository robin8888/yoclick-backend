import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { GetMyConsentsUseCase } from '../application/get-my-consents.use-case';
import { GetMyProfileUseCase } from '../application/get-my-profile.use-case';
import { ListMyMembershipsUseCase } from '../application/list-my-memberships.use-case';
import {
  type ConsentState,
  type MyMembership,
  type Profile,
} from '../application/ports/profile.repository';
import { SetMyConsentUseCase } from '../application/set-my-consent.use-case';
import { UpdateMyProfileUseCase } from '../application/update-my-profile.use-case';
import {
  MyConsentsResponseDto,
  MyMembershipsResponseDto,
  ProfileResponseDto,
  SetConsentRequestDto,
  UpdateProfileRequestDto,
} from './dto/profile-dtos';

export function serializeProfile(profile: Profile): Record<string, unknown> {
  return { ...profile, createdAt: profile.createdAt.toISOString() };
}

export function serializeMembership(membership: MyMembership): Record<string, unknown> {
  return { ...membership, joinedAt: membership.joinedAt.toISOString() };
}

export function serializeConsent(consent: ConsentState): Record<string, unknown> {
  return { ...consent, grantedAt: consent.grantedAt.toISOString() };
}

/** Rutas de la propia persona: solo tocan SUS datos, y siempre con el id que sale del token, nunca del cuerpo. */
@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('me')
@UserScoped()
export class MeController {
  constructor(
    private readonly getMyProfile: GetMyProfileUseCase,
    private readonly updateMyProfile: UpdateMyProfileUseCase,
    private readonly listMyMemberships: ListMyMembershipsUseCase,
    private readonly getMyConsents: GetMyConsentsUseCase,
    private readonly setMyConsent: SetMyConsentUseCase,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'me_get_profile', summary: 'Mi perfil.' })
  @ApiOkResponse({ type: ProfileResponseDto })
  async getProfile(@CurrentUserId() userId: string): Promise<Record<string, unknown>> {
    return serializeProfile(await this.getMyProfile.execute(userId));
  }

  @Patch()
  @ApiOperation({
    operationId: 'me_update_profile',
    summary:
      'Cambia mi nombre, teléfono, fecha de nacimiento o idioma. El correo no se cambia aquí.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  async updateProfile(
    @CurrentUserId() userId: string,
    @Body() body: UpdateProfileRequestDto,
  ): Promise<Record<string, unknown>> {
    return serializeProfile(await this.updateMyProfile.execute(userId, body));
  }

  @Get('memberships')
  @ApiOperation({
    operationId: 'me_list_memberships',
    summary: 'Mis centros, con su marca, para cambiar de centro.',
  })
  @ApiOkResponse({ type: MyMembershipsResponseDto })
  async listMemberships(@CurrentUserId() userId: string): Promise<Record<string, unknown>> {
    const memberships = await this.listMyMemberships.execute(userId);
    return { memberships: memberships.map(serializeMembership) };
  }

  @Get('consents')
  @ApiOperation({
    operationId: 'me_get_consents',
    summary: 'El estado vigente de cada consentimiento.',
  })
  @ApiOkResponse({ type: MyConsentsResponseDto })
  async getConsents(@CurrentUserId() userId: string): Promise<Record<string, unknown>> {
    const consents = await this.getMyConsents.execute(userId);
    return { consents: consents.map(serializeConsent) };
  }

  @Put('consents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'me_set_consent',
    summary:
      'Concede o retira un consentimiento opcional (marketing, imagen). Queda constancia de cada cambio.',
  })
  @ApiOkResponse({ type: MyConsentsResponseDto })
  async setConsent(
    @CurrentUserId() userId: string,
    @Body() body: SetConsentRequestDto,
  ): Promise<Record<string, unknown>> {
    const consents = await this.setMyConsent.execute(userId, body);
    return { consents: consents.map(serializeConsent) };
  }
}
