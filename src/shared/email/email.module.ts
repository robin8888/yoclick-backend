import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { type Environment } from '../config/environment.schema';
import { BrevoEmailSender } from './brevo-email-sender';
import { ConsoleEmailSender } from './console-email-sender';
import { EMAIL_SENDER, type EmailSender } from './email-sender';

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService, PinoLogger],
      useFactory: (
        configService: ConfigService<Environment, true>,
        logger: PinoLogger,
      ): EmailSender =>
        configService.get('EMAIL_PROVIDER', { infer: true }) === 'brevo'
          ? new BrevoEmailSender(configService)
          : new ConsoleEmailSender(logger),
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
