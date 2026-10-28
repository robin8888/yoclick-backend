import {
  buildVoiceUsageAlertMessage,
  type VoiceUsageAlertMessageInput,
} from './voice-usage-alert-message';

const BASE: VoiceUsageAlertMessageInput = {
  to: 'ana@example.com',
  fullName: 'Ana Pérez',
  centerName: 'Academia Ninja',
  percent: 80,
  usedMinutes: 120,
  includedMinutes: 150,
  overagePolicy: 'continue_and_charge',
  overageCentsPerMinute: 35,
};

describe('buildVoiceUsageAlertMessage', () => {
  it('warns at 80 % with the minutes used and what happens if they run out', () => {
    const message = buildVoiceUsageAlertMessage(BASE);

    expect(message.to).toBe('ana@example.com');
    expect(message.subject).toBe(
      'El Contestador IA de Academia Ninja ha usado el 80 % de sus minutos',
    );
    expect(message.textBody).toContain('Hola Ana,');
    expect(message.textBody).toContain('120 de los 150 minutos incluidos');
    expect(message.textBody).toContain(
      'Si se agotan, el asistente seguirá atendiendo las llamadas',
    );
    expect(message.textBody).toContain('0,35 € por minuto (IVA no incluido)');
  });

  it('says the minutes are used up at 100 %, and that the assistant keeps answering when charging the excess', () => {
    const message = buildVoiceUsageAlertMessage({ ...BASE, percent: 100, usedMinutes: 150 });

    expect(message.subject).toBe('El Contestador IA de Academia Ninja ha usado todos sus minutos');
    expect(message.textBody).toContain('El asistente sigue atendiendo las llamadas');
  });

  it('says the assistant stopped answering at 100 % when the center chose to switch it off', () => {
    const message = buildVoiceUsageAlertMessage({
      ...BASE,
      percent: 100,
      overagePolicy: 'disable_bot',
    });

    expect(message.textBody).toContain('El asistente ha dejado de atender las llamadas');
    expect(message.textBody).not.toContain('€');
  });

  it('warns at 80 % that it will stop when the center chose to switch it off', () => {
    const message = buildVoiceUsageAlertMessage({ ...BASE, overagePolicy: 'disable_bot' });

    expect(message.textBody).toContain('el asistente dejará de atender las llamadas');
  });

  it('writes whole euros without decimals and does not invent a price when there is none', () => {
    expect(buildVoiceUsageAlertMessage({ ...BASE, overageCentsPerMinute: 100 }).textBody).toContain(
      '1 € por minuto',
    );
    expect(
      buildVoiceUsageAlertMessage({ ...BASE, overageCentsPerMinute: null }).textBody,
    ).toContain('según tu tarifa del add-on');
  });

  it('carries no link: the option is changed inside the app', () => {
    expect(buildVoiceUsageAlertMessage(BASE).textBody).not.toMatch(/https?:\/\//);
  });
});
