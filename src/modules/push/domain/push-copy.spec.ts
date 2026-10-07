import { NOTIFICATION_KINDS } from '../../notifications/domain/notification-rules';
import { getPushCopy } from './push-copy';

describe('getPushCopy', () => {
  it.each(NOTIFICATION_KINDS)('has its own text for %s', (kind) => {
    const copy = getPushCopy(kind);

    expect(copy.title).not.toBe(getPushCopy('desconocido').title);
  });

  it('falls back to a generic text for a kind it does not know', () => {
    expect(getPushCopy('desconocido').title).toBe('Tienes un aviso nuevo');
  });

  it.each(NOTIFICATION_KINDS)('puts nothing personal in the text of %s', (kind) => {
    const { title, body } = getPushCopy(kind);

    expect(`${title} ${body}`).not.toMatch(/\d{1,2}:\d{2}|@|€/);
  });
});
