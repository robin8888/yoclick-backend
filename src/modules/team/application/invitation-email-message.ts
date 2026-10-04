import { type EmailMessage } from '../../../shared/email/email-sender';
import { formatInvitationCode } from '../domain/invitation-code';

const ROLE_DESCRIPTIONS = {
  admin: 'administrar',
  staff: 'formar parte del equipo de',
  client: 'unirte a',
} as const;

interface InvitationMessageDetails {
  readonly to: string;
  readonly centerName: string;
  readonly role: keyof typeof ROLE_DESCRIPTIONS;
  readonly code: string;
  readonly validForDays: number;
}

/** Sin enlaces, como el resto de correos de cuenta: el código se escribe en la app. */
export function buildInvitationMessage(details: InvitationMessageDetails): EmailMessage {
  return {
    to: details.to,
    subject: `Te han invitado a ${details.centerName}`,
    textBody: [
      `Te han invitado a ${ROLE_DESCRIPTIONS[details.role]} ${details.centerName} en Yoclick.`,
      '',
      'Abre la app de Yoclick, entra con tu cuenta (o créala con este mismo correo) y escribe este código de invitación:',
      '',
      formatInvitationCode(details.code),
      '',
      `Caduca en ${String(details.validForDays)} días y solo sirve una vez, con este correo.`,
      'Si no esperabas esta invitación, ignora este mensaje: no pasará nada.',
    ].join('\n'),
  };
}
