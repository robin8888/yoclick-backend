import { type EmailMessage } from '../../../shared/email/email-sender';
import {
  EXHAUSTED_PERCENT,
  type UsageAlertPercent,
  type VoiceOveragePolicyName,
} from '../domain/usage-minutes';

const CENTS_PER_EURO = 100;
const CENT_DECIMAL_PLACES = 2;

export interface VoiceUsageAlertMessageInput {
  readonly to: string;
  readonly fullName: string;
  readonly centerName: string;
  readonly percent: UsageAlertPercent;
  readonly usedMinutes: number;
  readonly includedMinutes: number;
  readonly overagePolicy: VoiceOveragePolicyName;
  /** `null` si el escalón no tiene precio de exceso en la base de datos. */
  readonly overageCentsPerMinute: number | null;
}

function formatEuros(cents: number): string {
  const euros = cents / CENTS_PER_EURO;
  const text = Number.isInteger(euros)
    ? String(euros)
    : euros.toFixed(CENT_DECIMAL_PLACES).replace('.', ',');
  return `${text} €`;
}

function describeOverageBilling(overageCentsPerMinute: number | null): string {
  return overageCentsPerMinute === null
    ? 'los minutos de más se facturarán según tu tarifa del add-on (IVA no incluido)'
    : `los minutos de más se facturarán a ${formatEuros(overageCentsPerMinute)} por minuto (IVA no incluido) en tu próxima factura`;
}

/** Lo que pasará, o ya está pasando, cuando se agotan los minutos incluidos, según la opción del centro. */
function describeConsequence(input: VoiceUsageAlertMessageInput): string {
  const isExhausted = input.percent === EXHAUSTED_PERCENT;
  if (input.overagePolicy === 'disable_bot') {
    return isExhausted
      ? 'El asistente ha dejado de atender las llamadas: sonarán como siempre en tu línea hasta que empiece el siguiente periodo.'
      : 'Si se agotan, el asistente dejará de atender las llamadas y sonarán como siempre en tu línea hasta que empiece el siguiente periodo.';
  }
  const billing = describeOverageBilling(input.overageCentsPerMinute);
  return isExhausted
    ? `El asistente sigue atendiendo las llamadas y ${billing}.`
    : `Si se agotan, el asistente seguirá atendiendo las llamadas y ${billing}.`;
}

function buildSubject(input: VoiceUsageAlertMessageInput): string {
  return input.percent === EXHAUSTED_PERCENT
    ? `El Contestador IA de ${input.centerName} ha usado todos sus minutos`
    : `El Contestador IA de ${input.centerName} ha usado el ${String(input.percent)} % de sus minutos`;
}

/**
 * El correo al propietario al llegar al 80 % y al 100 % de los minutos incluidos. Es el sitio donde sí van el
 * precio del exceso y lo que ocurrirá: en el push y en la app no se habla de importes (Apple 3.1.1). No lleva
 * enlaces: el cambio de opción se hace dentro de la app, en los ajustes del Contestador IA.
 */
export function buildVoiceUsageAlertMessage(input: VoiceUsageAlertMessageInput): EmailMessage {
  const firstName = input.fullName.trim().split(/\s+/)[0] ?? '';
  const textBody = [
    `Hola ${firstName},`,
    `El Contestador IA de ${input.centerName} ha usado ${String(input.usedMinutes)} de los ${String(input.includedMinutes)} minutos incluidos en este periodo.`,
    describeConsequence(input),
    'Puedes ver el consumo y cambiar esta opción en la app, en Contestador IA.',
    'El equipo de Yoclick',
  ].join('\n\n');
  return { to: input.to, subject: buildSubject(input), textBody };
}
