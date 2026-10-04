/**
 * Dominios de correo desechable. Verificar el email demuestra que la dirección existe, no que haya
 * una persona detrás: estos servicios regalan buzones de usar y tirar. Bloquearlos sube el coste de
 * crear cuentas falsas en masa. No es una defensa completa (salen dominios nuevos cada semana), es la
 * primera barrera; a medio plazo conviene una lista mantenida y actualizada.
 */
const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '20minutemail.com',
  'discard.email',
  'dispostable.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'inboxbear.com',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mintemail.com',
  'mohmal.com',
  'moakt.com',
  'sharklasers.com',
  'spamgourmet.com',
  'temp-mail.org',
  'tempmail.com',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

interface DisposableEmailPolicy {
  /** En desarrollo y tests se permiten (Yopmail sirve para ver correos reales); en producción, nunca. */
  readonly areDisposableEmailsAllowed: boolean;
}

export function isDisposableEmail(email: string, policy: DisposableEmailPolicy): boolean {
  if (policy.areDisposableEmailsAllowed) return false;

  const domain = email.split('@')[1]?.toLowerCase();
  return domain !== undefined && DISPOSABLE_EMAIL_DOMAINS.has(domain);
}
