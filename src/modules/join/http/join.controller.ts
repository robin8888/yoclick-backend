import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '../../../shared/auth/decorators/current-user-id.decorator';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { UserScoped } from '../../../shared/auth/decorators/user-scoped.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RATE_LIMITS } from '../../../shared/rate-limit/rate-limit-policies';
import { FindCenterByJoinCodeUseCase } from '../application/find-center-by-join-code.use-case';
import { JoinCenterUseCase } from '../application/join-center.use-case';
import { SearchCentersUseCase } from '../application/search-centers.use-case';
import {
  CenterIdParamsDto,
  CenterSearchQueryDto,
  CenterSearchResponseDto,
  JoinCenterRequestDto,
  JoinCenterResponseDto,
  JoinCodeParamsDto,
  PublicCenterResponseDto,
} from './dto/join-dtos';

@ApiTags('join')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('join')
export class JoinController {
  constructor(
    private readonly findCenterByJoinCode: FindCenterByJoinCodeUseCase,
    private readonly searchCenters: SearchCentersUseCase,
    private readonly joinCenter: JoinCenterUseCase,
  ) {}

  @Get('code/:code')
  @Public()
  @Throttle({ default: RATE_LIMITS.submitCode })
  @ApiOperation({
    operationId: 'join_find_center_by_code',
    summary:
      'El centro que corresponde a un código de unión. Un código desconocido responde 404 JOIN_CODE_INVALID.',
  })
  @ApiOkResponse({ type: PublicCenterResponseDto })
  async byCode(@Param() params: JoinCodeParamsDto): Promise<Record<string, unknown>> {
    return { ...(await this.findCenterByJoinCode.execute(params.code)) };
  }

  @Get('search')
  @Public()
  @ApiOperation({
    operationId: 'join_search_centers',
    summary:
      'Busca entre los centros que salen en el directorio, por texto y, si se envía ubicación, por cercanía.',
  })
  @ApiOkResponse({ type: CenterSearchResponseDto })
  async search(@Query() query: CenterSearchQueryDto): Promise<Record<string, unknown>> {
    const origin =
      query.lat !== undefined && query.lng !== undefined
        ? { latitude: query.lat, longitude: query.lng }
        : null;
    const centers = await this.searchCenters.execute({ textQuery: query.q ?? null, origin });
    return { centers };
  }

  @Post(':centerId')
  @UserScoped()
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'join_center',
    summary:
      'Te une al centro como cliente. Un centro privado exige su código de unión; uno listado, no. Comprueba el límite de clientes del plan.',
  })
  @ApiOkResponse({ type: JoinCenterResponseDto })
  async join(
    @CurrentUserId() userId: string,
    @Param() params: CenterIdParamsDto,
    @Body() body: JoinCenterRequestDto,
  ): Promise<Record<string, unknown>> {
    return {
      ...(await this.joinCenter.execute({
        userId,
        centerId: params.centerId,
        joinCode: body.joinCode,
        source: body.source,
      })),
    };
  }
}
