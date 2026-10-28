import { type EmailMessage } from '../../../shared/email/email-sender';
import { type PlanPaymentEmailReason } from '../domain/plan-payment-reminders';

const MONTHS_PER_YEAR = 12;
const CENTS_PER_EURO = 100;
const CENT_DECIMAL_PLACES = 2;
const TRIAL_LENGTH_DAYS = 14;

export interface PlanPaymentOption {
  readonly name: string;
  /** Céntimos al mes, sin IVA, pagando mes a mes. */
  readonly monthlyPriceCents: number;
  /** Céntimos por mes, sin IVA, pagando el año entero. */
  readonly annualMonthlyPriceCents: number;
  readonly monthlyUrl: string;
  readonly annualUrl: string;
}

interface PlanPaymentMessageDetails {
  readonly to: string;
  readonly fullName: string;
  readonly centerName: string;
  readonly reason: PlanPaymentEmailReason;
  readonly plans: readonly PlanPaymentOption[];
  readonly linkValidForDays: number;
}

function formatEuros(cents: number): string {
  const euros = cents / CENTS_PER_EURO;
  const text = Number.isInteger(euros)
    ? String(euros)
    : euros.toFixed(CENT_DECIMAL_PLACES).replace('.', ',');
  return `${text} €`;
}

function describeDaysLeft(daysLeft: number): string {
  return daysLeft === 1 ? 'mañana' : `en ${String(daysLeft)} días`;
}

function buildSubject(reason: PlanPaymentEmailReason): string {
  switch (reason.type) {
    case 'trial_started':
      return `Tienes ${String(TRIAL_LENGTH_DAYS)} días para probar Yoclick`;
    case 'trial_ending':
      return `Tu prueba de Yoclick acaba ${describeDaysLeft(reason.daysLeft)}`;
    case 'trial_ended':
      return 'Tu prueba de Yoclick ha terminado';
  }
}

function buildIntroduction(reason: PlanPaymentEmailReason, centerName: string): string {
  switch (reason.type) {
    case 'trial_started':
      return `Ya puedes usar Yoclick con ${centerName} durante ${String(TRIAL_LENGTH_DAYS)} días sin pagar nada. Cuando quieras quedarte, elige aquí tu plan.`;
    case 'trial_ending':
      return `La prueba gratuita de ${centerName} acaba ${describeDaysLeft(reason.daysLeft)}. Para seguir usando Yoclick sin cortes, elige tu plan.`;
    case 'trial_ended':
      return `La prueba gratuita de ${centerName} ha terminado. Elige un plan para volver a gestionar tu centro.`;
  }
}

function describePlan(plan: PlanPaymentOption): string[] {
  const annualTotalCents = plan.annualMonthlyPriceCents * MONTHS_PER_YEAR;
  return [
    plan.name,
    `  Pagar cada mes (${formatEuros(plan.monthlyPriceCents)} al mes): ${plan.monthlyUrl}`,
    `  Pagar el año entero (${formatEuros(plan.annualMonthlyPriceCents)} al mes, ${formatEuros(annualTotalCents)} al año): ${plan.annualUrl}`,
    '',
  ];
}

/**
 * Correo con los enlaces de pago de los planes.
 *
 * Es una excepción deliberada a la regla de «sin enlaces» de los correos de cuenta: la app no puede llevar a
 * pagar fuera (Apple y Google), así que el pago empieza aquí. Cada enlace es una URL firmada de Yoclick
 * (nunca una URL de Stripe ni un dominio ajeno) que caduca en `linkValidForDays` días, y al abrirla crea
 * una página de pago nueva de Stripe. El correo sigue siendo solo texto, sin HTML.
 */
export function buildPlanPaymentMessage(details: PlanPaymentMessageDetails): EmailMessage {
  return {
    to: details.to,
    subject: buildSubject(details.reason),
    textBody: [
      `Hola, ${details.fullName}:`,
      '',
      buildIntroduction(details.reason, details.centerName),
      '',
      'Precios sin IVA. El pago se hace en la página segura de Stripe, desde el navegador:',
      '',
      ...details.plans.flatMap(describePlan),
      `Los enlaces caducan en ${String(details.linkValidForDays)} días. Si ya has contratado un plan, ignora este mensaje.`,
      'Yoclick nunca te pedirá tu contraseña ni los datos de tu tarjeta por correo.',
    ].join('\n'),
  };
}
