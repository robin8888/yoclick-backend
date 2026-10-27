import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BookingWorld } from '../support/booking-world';
import { grantPlatformRoleAsOwner, resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface ChargeRow {
  id: string;
  centerId: string;
  centerName: string;
  chargedOn: string;
  baseCents: number;
  vatCents: number;
  totalCents: number;
  status: string;
  source: string;
  invoiceReference: string | null;
}

interface ChargePage {
  data: ChargeRow[];
  nextCursor: string | null;
}

interface ChargeReport {
  months: { month: string; baseCents: number; vatCents: number; totalCents: number }[];
  totals: { baseCents: number; vatCents: number; totalCents: number; chargeCount: number };
}

interface AuditPage {
  data: { action: string; centerId: string | null }[];
}

const PAID_CHARGE = {
  chargedOn: '2026-10-15',
  concept: 'Plan Pro, octubre 2026',
  baseCents: 7900,
  vatBasisPoints: 2100,
  paymentMethod: 'transfer',
  customerLegalName: 'Primer Centro S.L.',
  customerTaxId: 'B12345678',
};

describe('platform charges and accountant reports', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let adminUserId: string;
  let accountantUserId: string;
  let centerId: string;

  const asAdmin = (method: 'GET' | 'POST' | 'PATCH', url: string, body?: object) =>
    world.call(method, url, adminUserId, body === undefined ? {} : { body });
  const asAccountant = (method: 'GET' | 'POST' | 'PATCH', url: string, body?: object) =>
    world.call(method, url, accountantUserId, body === undefined ? {} : { body });

  const recordCharge = async (overrides: object = {}): Promise<ChargeRow> => {
    const response = await asAdmin('POST', '/v1/platform/charges', {
      centerId,
      ...PAID_CHARGE,
      ...overrides,
    });
    expect(response.statusCode).toBe(201);
    return response.json<ChargeRow>();
  };

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    adminUserId = await world.fixtures.createUser('platform-admin');
    await grantPlatformRoleAsOwner(adminUserId, 'admin');
    accountantUserId = await world.fixtures.createUser('accountant');
    await grantPlatformRoleAsOwner(accountantUserId, 'accountant');
    const owner = await world.fixtures.createUser('center-owner');
    centerId = (await world.createCenter(owner, 'Primer Centro')).centerId;
  });

  afterAll(async () => {
    await application.close();
  });

  describe('POST /platform/charges', () => {
    it('works out the VAT and the total from the base and the rate', async () => {
      const charge = await recordCharge();

      expect(charge).toMatchObject({
        centerName: 'Primer Centro',
        baseCents: 7900,
        vatCents: 1659,
        totalCents: 9559,
        status: 'paid',
        source: 'manual',
      });
    });

    it('leaves a trace in the audit log', async () => {
      await recordCharge();

      const audit = (await asAdmin('GET', '/v1/platform/audit-log')).json<AuditPage>();

      expect(audit.data).toContainEqual(
        expect.objectContaining({ action: 'charge_recorded', centerId }),
      );
    });

    it('refuses a charge dated in the future', async () => {
      const response = await asAdmin('POST', '/v1/platform/charges', {
        centerId,
        ...PAID_CHARGE,
        chargedOn: '2999-01-01',
      });

      expect(response.statusCode).toBe(400);
    });

    it('refuses a center that does not exist', async () => {
      const response = await asAdmin('POST', '/v1/platform/charges', {
        centerId: '0198a8a0-0000-7000-8000-000000000000',
        ...PAID_CHARGE,
      });

      expect(response.statusCode).toBe(404);
    });

    it('refuses an amount the client tries to fix by hand', async () => {
      const response = await asAdmin('POST', '/v1/platform/charges', {
        centerId,
        ...PAID_CHARGE,
        totalCents: 1,
      });

      expect(response.statusCode).toBe(400);
    });

    it('keeps the accountant from recording charges', async () => {
      const response = await asAccountant('POST', '/v1/platform/charges', {
        centerId,
        ...PAID_CHARGE,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /platform/charges', () => {
    it('lets the accountant read the charges, newest first', async () => {
      await recordCharge({ chargedOn: '2026-09-10' });
      await recordCharge({ chargedOn: '2026-10-15' });

      const response = await asAccountant('GET', '/v1/platform/charges');

      expect(response.statusCode).toBe(200);
      expect(response.json<ChargePage>().data.map((charge) => charge.chargedOn)).toEqual([
        '2026-10-15',
        '2026-09-10',
      ]);
    });

    it('filters by month and pages with a cursor', async () => {
      await recordCharge({ chargedOn: '2026-10-02' });
      await recordCharge({ chargedOn: '2026-10-20' });
      await recordCharge({ chargedOn: '2026-09-10' });

      const firstPage = (
        await asAdmin('GET', '/v1/platform/charges?month=2026-10&limit=1')
      ).json<ChargePage>();
      const secondPage = (
        await asAdmin(
          'GET',
          `/v1/platform/charges?month=2026-10&limit=1&cursor=${firstPage.nextCursor ?? ''}`,
        )
      ).json<ChargePage>();

      expect(firstPage.data.map((charge) => charge.chargedOn)).toEqual(['2026-10-20']);
      expect(secondPage.data.map((charge) => charge.chargedOn)).toEqual(['2026-10-02']);
      expect(secondPage.nextCursor).toBeNull();
    });

    it('rejects a month that is not YYYY-MM', async () => {
      const response = await asAdmin('GET', '/v1/platform/charges?month=2026-13');

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PATCH /platform/charges/:chargeId', () => {
    it('stores the invoice reference and audits it', async () => {
      const charge = await recordCharge();

      const response = await asAdmin('PATCH', `/v1/platform/charges/${charge.id}`, {
        invoiceReference: 'F-2026-001',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<ChargeRow>().invoiceReference).toBe('F-2026-001');
      const audit = (await asAdmin('GET', '/v1/platform/audit-log')).json<AuditPage>();
      expect(audit.data.map((entry) => entry.action)).toContain('charge_invoice_set');
    });

    it('voids a charge and then refuses any further change', async () => {
      const charge = await recordCharge();
      await asAdmin('PATCH', `/v1/platform/charges/${charge.id}`, { status: 'void' });

      const response = await asAdmin('PATCH', `/v1/platform/charges/${charge.id}`, {
        status: 'paid',
      });

      expect(response.statusCode).toBe(409);
    });

    it('keeps the accountant from changing a charge', async () => {
      const charge = await recordCharge();

      const response = await asAccountant('PATCH', `/v1/platform/charges/${charge.id}`, {
        status: 'void',
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('reports', () => {
    it('adds up the paid charges per month and leaves out voided and pending ones', async () => {
      await recordCharge({ chargedOn: '2026-08-02' });
      await recordCharge({ chargedOn: '2026-09-03' });
      await recordCharge({ chargedOn: '2026-09-04', status: 'pending' });
      const voided = await recordCharge({ chargedOn: '2026-09-05' });
      await asAdmin('PATCH', `/v1/platform/charges/${voided.id}`, { status: 'void' });

      const response = await asAccountant(
        'GET',
        '/v1/platform/reports/monthly?fromMonth=2026-08&toMonth=2026-10',
      );

      expect(response.statusCode).toBe(200);
      const report = response.json<ChargeReport>();
      expect(report.months.map((month) => month.month)).toEqual(['2026-08', '2026-09']);
      expect(report.totals).toMatchObject({
        baseCents: 15800,
        vatCents: 3318,
        totalCents: 19118,
        chargeCount: 2,
      });
    });

    it('rejects an upside-down range', async () => {
      const response = await asAdmin(
        'GET',
        '/v1/platform/reports/monthly?fromMonth=2026-12&toMonth=2026-10',
      );

      expect(response.statusCode).toBe(400);
    });

    it('exports a CSV the accountant can open in a spreadsheet', async () => {
      await recordCharge({ invoiceReference: 'F-2026-001' });

      const response = await asAccountant(
        'GET',
        '/v1/platform/reports/export.csv?fromMonth=2026-10&toMonth=2026-10',
      );

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('cobros-2026-10-2026-10.csv');
      const lines = response.body.trimEnd().split('\r\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe(
        '2026-10-15;2026-10;Primer Centro;Primer Centro S.L.;B12345678;79,00;21;16,59;95,59;;transfer;F-2026-001;',
      );
    });

    it('never carries personal data of the center clients', async () => {
      await world.addMember(centerId, 'ana', 'client');
      await recordCharge();

      const response = await asAccountant(
        'GET',
        '/v1/platform/reports/export.csv?fromMonth=2026-10&toMonth=2026-10',
      );

      expect(response.body).not.toMatch(/ana@|center-owner/i);
    });
  });
});
