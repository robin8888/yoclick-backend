import { Inject, Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { DomainError } from '../../../shared/errors/domain-error';
import { HTTP_STATUS } from '../../../shared/errors/http-status';
import { EMAIL_SENDER, type EmailSender } from '../../../shared/email/email-sender';
import { MILLISECONDS_PER_DAY } from '../../../shared/time/time-units';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import {
  generateInvitationCode,
  hashInvitationCode,
  INVITATION_VALID_DAYS,
  formatInvitationCode,
  maskEmailAddress,
  normalizeInvitationCode,
} from '../domain/invitation-code';
import { normalizePhoneNumber } from '../domain/phone-number';
import { canInviteRole, type TeamMemberStatus, type TeamRoleName } from '../domain/team-rules';
import { buildInvitationMessage } from './invitation-email-message';
import {
  INVITATION_REPOSITORY,
  type InvitationPreview,
  type InvitationRepository,
  type PendingInvitation,
} from './ports/invitation.repository';

/** A quién va el código: a un correo (lo envía la API) o a un teléfono (lo comparte la app por WhatsApp o SMS). */
export interface InviteRequest {
  readonly actor: ActorContext;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly role: 'admin' | 'staff' | 'client';
}

export interface CreatedInvitation {
  readonly id: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly role: 'admin' | 'staff' | 'client';
  readonly expiresAt: Date;
  /** El código tal como se lee y se teclea (`ABCD-EFGH-JKLM`). Solo se ve ahora: en la base queda su hash. */
  readonly code: string;
}

@Injectable()
export class InviteToCenterUseCase {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  async execute(request: InviteRequest): Promise<CreatedInvitation> {
    const { actor, role } = request;
    const email = request.email?.toLowerCase() ?? null;
    const phone = resolvePhone(request.phone);
    if (email === null && phone === null) {
      throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest);
    }
    if (!canInviteRole(actor.role, role)) throw new DomainError('FORBIDDEN', HTTP_STATUS.forbidden);
    if (email !== null && (await this.invitations.hasMemberWithEmail(actor, email))) {
      throw new DomainError('ALREADY_MEMBER', HTTP_STATUS.conflict);
    }

    const now = new Date();
    const code = generateInvitationCode();
    const invitation = {
      id: generateUuidV7(),
      email,
      phone,
      role,
      tokenHash: hashInvitationCode(code),
      invitedByUserId: actor.userId,
      expiresAt: new Date(now.getTime() + INVITATION_VALID_DAYS * MILLISECONDS_PER_DAY),
    };
    await this.invitations.createReplacingPending(actor, invitation, now);

    if (email !== null) await this.sendInvitationEmail({ actor, email, role, code });
    return {
      id: invitation.id,
      email,
      phone,
      role,
      expiresAt: invitation.expiresAt,
      code: formatInvitationCode(code),
    };
  }

  private async sendInvitationEmail(input: {
    actor: ActorContext;
    email: string;
    role: InviteRequest['role'];
    code: string;
  }): Promise<void> {
    const centerName = (await this.invitations.findCenterName(input.actor)) ?? 'tu centro';
    await this.emailSender.send(
      buildInvitationMessage({
        to: input.email,
        centerName,
        role: input.role,
        code: input.code,
        validForDays: INVITATION_VALID_DAYS,
      }),
    );
  }
}

/** Un teléfono mal escrito es un error de datos, no algo que se pueda corregir en silencio. */
function resolvePhone(rawPhone: string | undefined): string | null {
  if (rawPhone === undefined) return null;
  const phone = normalizePhoneNumber(rawPhone);
  if (phone === null) throw new DomainError('VALIDATION_FAILED', HTTP_STATUS.badRequest);
  return phone;
}

@Injectable()
export class ListPendingInvitationsUseCase {
  constructor(@Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository) {}

  async execute(actor: ActorContext): Promise<PendingInvitation[]> {
    return this.invitations.listPending(actor, new Date());
  }
}

@Injectable()
export class RevokeInvitationUseCase {
  constructor(@Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository) {}

  async execute(actor: ActorContext, invitationId: string): Promise<void> {
    const wasRevoked = await this.invitations.revoke(actor, invitationId, new Date());
    if (!wasRevoked) throw new DomainError('NOT_FOUND', HTTP_STATUS.notFound);
  }
}

export interface PublicInvitationPreview {
  readonly role: InvitationPreview['role'];
  /** `null` si se invitó por teléfono: la persona se registra con el correo que quiera. */
  readonly emailHint: string | null;
  readonly expiresAt: Date;
  readonly center: InvitationPreview['center'];
}

/** Un código mal formado, desconocido, caducado, usado o revocado responde igual. */
@Injectable()
export class GetInvitationPreviewUseCase {
  constructor(@Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository) {}

  async execute(rawCode: string): Promise<PublicInvitationPreview> {
    const code = normalizeInvitationCode(rawCode);
    const preview = code
      ? await this.invitations.findPreview(hashInvitationCode(code), new Date())
      : null;
    if (!preview) throw new DomainError('INVITATION_INVALID', HTTP_STATUS.notFound);
    return {
      role: preview.role,
      emailHint: preview.email === null ? null : maskEmailAddress(preview.email),
      expiresAt: preview.expiresAt,
      center: preview.center,
    };
  }
}

export interface AcceptedMembership {
  readonly membershipId: string;
  readonly centerId: string;
  readonly role: TeamRoleName;
  readonly status: TeamMemberStatus;
}

const REFUSALS = {
  invalid: { code: 'INVITATION_INVALID', httpStatus: HTTP_STATUS.notFound },
  membership_blocked: { code: 'MEMBERSHIP_BLOCKED', httpStatus: HTTP_STATUS.forbidden },
  client_limit_reached: { code: 'CLIENT_LIMIT_REACHED', httpStatus: HTTP_STATUS.conflict },
} as const;

@Injectable()
export class AcceptInvitationUseCase {
  constructor(@Inject(INVITATION_REPOSITORY) private readonly invitations: InvitationRepository) {}

  async execute(userId: string, rawCode: string): Promise<AcceptedMembership> {
    const code = normalizeInvitationCode(rawCode);
    const outcome = code
      ? await this.invitations.accept({
          tokenHash: hashInvitationCode(code),
          userId,
          now: new Date(),
        })
      : ({ kind: 'invalid' } as const);

    if (outcome.kind !== 'accepted') {
      const refusal = REFUSALS[outcome.kind];
      throw new DomainError(refusal.code, refusal.httpStatus);
    }
    return {
      membershipId: outcome.membership.id,
      centerId: outcome.membership.centerId,
      role: outcome.membership.role,
      status: outcome.membership.status,
    };
  }
}
