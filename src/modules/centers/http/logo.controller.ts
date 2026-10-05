import { Controller, Get, Headers, HttpStatus, Param, Res } from '@nestjs/common';
import { ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type FastifyReply } from 'fastify';
import { z } from 'zod';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { createZodDto } from '../../../shared/http/create-zod-dto';
import { GetCenterLogoUseCase } from '../application/get-center-logo.use-case';
import { matchesIfNoneMatch } from '../domain/entity-tag-matching';

const LOGO_CACHE_CONTROL = 'public, max-age=86400';
const BINARY_IMAGE_SCHEMA = { type: 'string', format: 'binary' } as const;

class CenterLogoParamsDto extends createZodDto(z.strictObject({ centerId: z.uuid() })) {}

@ApiTags('centers')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('centers/:centerId')
export class LogoController {
  constructor(private readonly getCenterLogo: GetCenterLogoUseCase) {}

  @Get('logo')
  @Public()
  @ApiOperation({
    operationId: 'centers_get_logo',
    summary:
      'Logo del centro (imagen). Público, con ETag y caché de un día; admite If-None-Match (304).',
  })
  @ApiOkResponse({
    description: 'Los bytes de la imagen, con su Content-Type',
    content: {
      'image/png': { schema: BINARY_IMAGE_SCHEMA },
      'image/jpeg': { schema: BINARY_IMAGE_SCHEMA },
      'image/webp': { schema: BINARY_IMAGE_SCHEMA },
    },
  })
  async logo(
    @Param() params: CenterLogoParamsDto,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer | undefined> {
    const logo = await this.getCenterLogo.execute(params.centerId);
    const entityTag = `"${logo.sha256}"`;
    void reply
      .header('etag', entityTag)
      .header('cache-control', LOGO_CACHE_CONTROL)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline');

    if (matchesIfNoneMatch(ifNoneMatch, entityTag)) {
      void reply.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    void reply.header('content-type', logo.contentType);
    return logo.bytes;
  }
}
