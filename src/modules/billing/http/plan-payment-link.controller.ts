import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiFoundResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { type FastifyReply } from 'fastify';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { OpenPlanPaymentLinkUseCase } from '../application/plan-payment.use-cases';

const MAX_TOKEN_LENGTH = 2048;

class PlanPaymentLinkQueryDto extends createZodDto(
  z.strictObject({ token: z.string().min(1).max(MAX_TOKEN_LENGTH) }),
) {}

@ApiTags('billing')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('billing')
export class PlanPaymentLinkController {
  constructor(private readonly openPlanPaymentLink: OpenPlanPaymentLinkUseCase) {}

  @Get('pay')
  @Public()
  @ApiOperation({
    operationId: 'billing_open_plan_payment_link',
    summary:
      'Enlace firmado de los correos de pago del plan: crea una página de pago de Stripe nueva y redirige a ella. 400 PAYMENT_LINK_INVALID si el enlace caducó o no es válido. No lo usa la app.',
  })
  @ApiQuery({ name: 'token', required: true })
  @ApiFoundResponse({ description: 'Redirige a la página de pago de Stripe' })
  async open(@Query() query: PlanPaymentLinkQueryDto, @Res() reply: FastifyReply): Promise<void> {
    const { url } = await this.openPlanPaymentLink.execute(query.token);
    await reply.redirect(url, HttpStatus.FOUND);
  }
}
