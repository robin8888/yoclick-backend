import { type PlanPaymentEmailReason } from '../domain/plan-payment-reminders';
import { buildPlanPaymentMessage, type PlanPaymentOption } from './plan-payment-message';

const PLANS: PlanPaymentOption[] = [
  {
    name: 'Básico',
    monthlyPriceCents: 3900,
    annualMonthlyPriceCents: 3250,
    monthlyUrl: 'https://api.yoclick.app/v1/billing/pay?token=basic-monthly',
    annualUrl: 'https://api.yoclick.app/v1/billing/pay?token=basic-annual',
  },
  {
    name: 'Pro',
    monthlyPriceCents: 7900,
    annualMonthlyPriceCents: 6590,
    monthlyUrl: 'https://api.yoclick.app/v1/billing/pay?token=pro-monthly',
    annualUrl: 'https://api.yoclick.app/v1/billing/pay?token=pro-annual',
  },
];

function build(reason: PlanPaymentEmailReason) {
  return buildPlanPaymentMessage({
    to: 'owner@example.com',
    fullName: 'Ana',
    centerName: 'Gymtonic',
    reason,
    plans: PLANS,
    linkValidForDays: 14,
  });
}

describe('buildPlanPaymentMessage', () => {
  it.each<{ name: string; reason: PlanPaymentEmailReason; subject: string; mention: string }>([
    {
      name: 'a trial that starts',
      reason: { type: 'trial_started' },
      subject: 'Tienes 14 días para probar Yoclick',
      mention: 'durante 14 días sin pagar nada',
    },
    {
      name: 'a trial that ends in seven days',
      reason: { type: 'trial_ending', daysLeft: 7 },
      subject: 'Tu prueba de Yoclick acaba en 7 días',
      mention: 'acaba en 7 días',
    },
    {
      name: 'a trial that ends in three days',
      reason: { type: 'trial_ending', daysLeft: 3 },
      subject: 'Tu prueba de Yoclick acaba en 3 días',
      mention: 'acaba en 3 días',
    },
    {
      name: 'a trial that ends tomorrow',
      reason: { type: 'trial_ending', daysLeft: 1 },
      subject: 'Tu prueba de Yoclick acaba mañana',
      mention: 'acaba mañana',
    },
    {
      name: 'a trial that has ended',
      reason: { type: 'trial_ended' },
      subject: 'Tu prueba de Yoclick ha terminado',
      mention: 'ha terminado',
    },
  ])('writes the subject and introduction for $name', ({ reason, subject, mention }) => {
    const message = build(reason);

    expect(message.to).toBe('owner@example.com');
    expect(message.subject).toBe(subject);
    expect(message.textBody).toContain('Hola, Ana:');
    expect(message.textBody).toContain(mention);
    expect(message.textBody).toContain('Gymtonic');
  });

  it('lists every plan with its monthly and annual price and link', () => {
    const { textBody } = build({ type: 'trial_ended' });

    expect(textBody).toContain(
      'Pagar cada mes (39 € al mes): https://api.yoclick.app/v1/billing/pay?token=basic-monthly',
    );
    expect(textBody).toContain(
      '(32,50 € al mes, 390 € al año): https://api.yoclick.app/v1/billing/pay?token=basic-annual',
    );
    expect(textBody).toContain(
      'Pagar cada mes (79 € al mes): https://api.yoclick.app/v1/billing/pay?token=pro-monthly',
    );
    expect(textBody).toContain('(65,90 € al mes, 790,80 € al año)');
  });

  it('says prices are without VAT, when the links expire and that nothing sensitive is asked by email', () => {
    const { textBody } = build({ type: 'trial_ended' });

    expect(textBody).toContain('Precios sin IVA');
    expect(textBody).toContain('caducan en 14 días');
    expect(textBody).toContain('nunca te pedirá tu contraseña');
  });

  it('only links to the Yoclick API, never to another domain', () => {
    const links = build({ type: 'trial_ended' }).textBody.match(/https?:\/\/\S+/g) ?? [];

    expect(links).toHaveLength(PLANS.length * 2);
    expect(links.every((link) => link.startsWith('https://api.yoclick.app/'))).toBe(true);
  });
});
