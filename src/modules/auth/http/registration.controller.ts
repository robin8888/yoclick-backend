import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiDefaultResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { type FastifyRequest } from 'fastify';
import { Public } from '../../../shared/auth/decorators/public.decorator';
import { ProblemDetailsDto } from '../../../shared/errors/problem-details.dto';
import { RegisterUserUseCase } from '../application/register-user.use-case';
import { ResendEmailVerificationUseCase } from '../application/resend-email-verification.use-case';
import { VerifyEmailUseCase } from '../application/verify-email.use-case';
import { ClientAddressHasher } from '../infrastructure/client-address.hasher';
import {
  EmailVerifiedResponseDto,
  VerificationSentResponseDto,
} from './dto/auth-status-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { ResendEmailVerificationRequestDto } from './dto/resend-email-verification-request.dto';
import { VerifyEmailRequestDto } from './dto/verify-email-request.dto';

@ApiTags('auth')
@ApiDefaultResponse({ type: ProblemDetailsDto, description: 'Error RFC 9457' })
@Controller('auth')
@Public()
export class RegistrationController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly verifyEmail: VerifyEmailUseCase,
    private readonly resendEmailVerification: ResendEmailVerificationUseCase,
    private readonly clientAddressHasher: ClientAddressHasher,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'auth_register',
    summary:
      'Crea una cuenta y envía un código de 6 dígitos al correo. Responde igual exista o no la cuenta.',
  })
  @ApiAcceptedResponse({ type: VerificationSentResponseDto })
  async register(
    @Body() body: RegisterRequestDto,
    @Req() request: FastifyRequest,
  ): Promise<{ status: 'verification_sent' }> {
    await this.registerUser.execute({
      email: body.email,
      password: body.password,
      fullName: body.fullName,
      consents: body.consents,
      clientIpHash: this.clientAddressHasher.hash(request.ip),
    });
    return { status: 'verification_sent' };
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auth_verify_email',
    summary: 'Confirma el correo con el código de 6 dígitos (5 intentos, 15 minutos).',
  })
  @ApiOkResponse({ type: EmailVerifiedResponseDto })
  async verify(@Body() body: VerifyEmailRequestDto): Promise<{ status: 'verified' }> {
    await this.verifyEmail.execute({ email: body.email, code: body.code });
    return { status: 'verified' };
  }

  @Post('email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'auth_resend_email_verification',
    summary: 'Reenvía el código. Responde igual exista o no la cuenta.',
  })
  @ApiAcceptedResponse({ type: VerificationSentResponseDto })
  async resend(
    @Body() body: ResendEmailVerificationRequestDto,
  ): Promise<{ status: 'verification_sent' }> {
    await this.resendEmailVerification.execute({ email: body.email });
    return { status: 'verification_sent' };
  }
}
