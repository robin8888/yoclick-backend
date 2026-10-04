import { type EmailMessage } from '../../../shared/email/email-sender';

interface RecipientDetails {
  readonly to: string;
  readonly fullName: string;
}

interface VerificationCodeDetails extends RecipientDetails {
  readonly code: string;
  readonly validForMinutes: number;
}

const IGNORE_IF_NOT_YOU =
  'Si no has sido tú, ignora este mensaje: nadie podrá usar tu cuenta sin el código.';
const NEVER_SHARE =
  'No compartas este código con nadie. Yoclick nunca te lo pedirá por otro medio.';

/**
 * Textos de los correos de cuenta. Español de España, tuteo, sin enlaces (un enlace en un correo es
 * la forma más habitual de suplantación: el código se escribe en la app) y sin HTML.
 */
export function buildEmailVerificationMessage(details: VerificationCodeDetails): EmailMessage {
  return {
    to: details.to,
    subject: 'Tu código para confirmar el correo',
    textBody: [
      `Hola, ${details.fullName}:`,
      '',
      `Tu código para confirmar tu correo es ${details.code}.`,
      `Caduca en ${String(details.validForMinutes)} minutos.`,
      '',
      NEVER_SHARE,
      IGNORE_IF_NOT_YOU,
    ].join('\n'),
  };
}

/** Se envía cuando alguien intenta registrarse con un correo que ya tiene cuenta (sin revelarlo en la app). */
export function buildAlreadyRegisteredMessage(details: RecipientDetails): EmailMessage {
  return {
    to: details.to,
    subject: 'Ya tienes una cuenta en Yoclick',
    textBody: [
      `Hola, ${details.fullName}:`,
      '',
      'Alguien ha intentado crear una cuenta con este correo, pero ya tienes una.',
      'Puedes iniciar sesión o, si no recuerdas la contraseña, recuperarla desde la pantalla de acceso.',
      '',
      IGNORE_IF_NOT_YOU,
    ].join('\n'),
  };
}

/** Aviso al dueño de que su cuenta se ha bloqueado unos minutos tras muchos intentos fallidos. */
export function buildAccountLockedMessage(details: RecipientDetails): EmailMessage {
  return {
    to: details.to,
    subject: 'Hemos bloqueado tu cuenta unos minutos',
    textBody: [
      `Hola, ${details.fullName}:`,
      '',
      'Hemos detectado varios intentos fallidos de entrar en tu cuenta y la hemos bloqueado durante 15 minutos por seguridad.',
      'Si has sido tú, espera ese tiempo y vuelve a probar. Si no, cambia tu contraseña desde la pantalla de acceso.',
      '',
      NEVER_SHARE,
    ].join('\n'),
  };
}

/** Aviso de que la contraseña cambió. Nunca incluye la contraseña, ni vieja ni nueva. */
export function buildPasswordChangedMessage(details: RecipientDetails): EmailMessage {
  return {
    to: details.to,
    subject: 'Tu contraseña se ha cambiado',
    textBody: [
      `Hola, ${details.fullName}:`,
      '',
      'La contraseña de tu cuenta de Yoclick se acaba de cambiar y hemos cerrado tu sesión en todos los dispositivos.',
      'Si has sido tú, no tienes que hacer nada: vuelve a iniciar sesión con la nueva.',
      'Si no has sido tú, recupera tu cuenta ahora desde la pantalla de acceso y revisa la seguridad de tu correo.',
    ].join('\n'),
  };
}

export function buildPasswordResetMessage(details: VerificationCodeDetails): EmailMessage {
  return {
    to: details.to,
    subject: 'Tu código para cambiar la contraseña',
    textBody: [
      `Hola, ${details.fullName}:`,
      '',
      `Tu código para cambiar la contraseña es ${details.code}.`,
      `Caduca en ${String(details.validForMinutes)} minutos.`,
      '',
      NEVER_SHARE,
      'Si no has pedido cambiar la contraseña, ignora este mensaje: la tuya sigue siendo la misma.',
    ].join('\n'),
  };
}
