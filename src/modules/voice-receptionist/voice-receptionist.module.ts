import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Environment } from '../../shared/config/environment.schema';
import { BillingModule } from '../billing/billing.module';
import { BookingsModule } from '../bookings/bookings.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { HandleVoiceCallEndUseCase } from './application/handle-voice-call-end.use-case';
import { HandleVoiceToolUseCase } from './application/handle-voice-tool.use-case';
import { IdentifyCallerUseCase } from './application/identify-caller.use-case';
import { VOICE_ADMIN_REPOSITORY } from './application/ports/voice-admin.repository';
import { VOICE_AGENT_PROVIDER } from './application/ports/voice-agent-provider';
import { VOICE_CALL_REPOSITORY } from './application/ports/voice-call.repository';
import { VOICE_OVERAGE_REPOSITORY } from './application/ports/voice-overage.repository';
import { ReportVoiceOverageUseCase } from './application/report-voice-overage.use-case';
import { SendVoiceUsageAlertsUseCase } from './application/send-voice-usage-alerts.use-case';
import { VoiceOverageReportSweeper } from './application/voice-overage-report-sweeper';
import { ResolveVoiceCallUseCase } from './application/resolve-voice-call.use-case';
import { GetVoiceAvailabilityUseCase } from './application/voice-availability.use-case';
import {
  CancelVoiceBookingUseCase,
  CreateVoiceBookingUseCase,
  ListCallerBookingsUseCase,
  RescheduleVoiceBookingUseCase,
} from './application/voice-booking.use-cases';
import {
  DeprovisionVoiceReceptionistUseCase,
  GetMyStudentCodeUseCase,
  GetVoiceOverviewUseCase,
  ListVoiceCallsUseCase,
  ProvisionVoiceReceptionistUseCase,
  SetVoiceEnabledUseCase,
  UpdateVoiceConfigUseCase,
} from './application/voice-admin.use-cases';
import { VoiceTranscriptSweeper } from './application/voice-transcript-sweeper';
import {
  AddCallerToVoiceWaitlistUseCase,
  TransferVoiceCallUseCase,
} from './application/voice-waitlist-and-transfer.use-cases';
import {
  PlatformVoiceReceptionistController,
  StudentCodeController,
  VoiceReceptionistController,
} from './http/voice-receptionist.controller';
import { VoiceWebhooksController } from './http/voice-webhooks.controller';
import { FakeVoiceAgentProvider } from './infrastructure/fake-voice-agent-provider';
import { PrismaVoiceAdminRepository } from './infrastructure/prisma-voice-admin.repository';
import { PrismaVoiceCallRepository } from './infrastructure/prisma-voice-call.repository';
import { PrismaVoiceOverageRepository } from './infrastructure/prisma-voice-overage.repository';
import { VapiVoiceAgentProvider } from './infrastructure/vapi-voice-agent-provider';

/**
 * Contestador IA de citas (add-on). Módulo aislado: solo se apoya en los casos de uso de reservas, agenda y
 * lista de espera ya existentes (BookingsModule, SchedulingModule y WaitlistModule los exportan), así que el bot
 * reserva con exactamente las mismas reglas que la app. Con `isVoiceReceptionistEnabled` apagado no hace nada.
 * Diseño y subencargados del tratamiento: docs/spec/07-contestador-ia.md.
 */
@Module({
  imports: [BillingModule, BookingsModule, SchedulingModule, WaitlistModule],
  controllers: [
    VoiceWebhooksController,
    VoiceReceptionistController,
    StudentCodeController,
    PlatformVoiceReceptionistController,
  ],
  providers: [
    ResolveVoiceCallUseCase,
    IdentifyCallerUseCase,
    GetVoiceAvailabilityUseCase,
    ListCallerBookingsUseCase,
    CreateVoiceBookingUseCase,
    CancelVoiceBookingUseCase,
    RescheduleVoiceBookingUseCase,
    AddCallerToVoiceWaitlistUseCase,
    TransferVoiceCallUseCase,
    HandleVoiceToolUseCase,
    HandleVoiceCallEndUseCase,
    GetVoiceOverviewUseCase,
    UpdateVoiceConfigUseCase,
    SetVoiceEnabledUseCase,
    ListVoiceCallsUseCase,
    GetMyStudentCodeUseCase,
    ProvisionVoiceReceptionistUseCase,
    DeprovisionVoiceReceptionistUseCase,
    ReportVoiceOverageUseCase,
    SendVoiceUsageAlertsUseCase,
    VoiceTranscriptSweeper,
    VoiceOverageReportSweeper,
    { provide: VOICE_CALL_REPOSITORY, useClass: PrismaVoiceCallRepository },
    { provide: VOICE_ADMIN_REPOSITORY, useClass: PrismaVoiceAdminRepository },
    { provide: VOICE_OVERAGE_REPOSITORY, useClass: PrismaVoiceOverageRepository },
    {
      provide: VOICE_AGENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => {
        const secret = config.get('VOICE_WEBHOOK_SECRET', { infer: true });
        return config.get('VOICE_PROVIDER', { infer: true }) === 'vapi' && secret !== undefined
          ? new VapiVoiceAgentProvider(secret)
          : new FakeVoiceAgentProvider(secret);
      },
    },
  ],
  exports: [VoiceTranscriptSweeper, VoiceOverageReportSweeper],
})
export class VoiceReceptionistModule {}
