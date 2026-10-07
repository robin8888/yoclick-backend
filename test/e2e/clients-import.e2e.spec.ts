import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { type TenantTransactionClient } from '../../src/shared/database/tenant-prisma.service';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

interface ImportReportBody {
  createdCount: number;
  updatedCount: number;
  skipped: { rowNumber: number; email: string | null; reason: string }[];
}

describe('importing clients from a file', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let prisma: PrismaService;
  let owner: string;
  let center: CreatedTestCenter;

  const ownerActor = () =>
    ({
      userId: owner,
      centerId: center.centerId,
      membershipId: center.ownerMembershipId,
      role: 'owner',
      permissions: [],
    }) as const;
  const inCenter = <TResult>(work: (client: TenantTransactionClient) => Promise<TResult>) =>
    world.tenantPrismaService.runInTenantContext(ownerActor(), work);

  const importUrl = (): string => `/v1/centers/${center.centerId}/clients/import`;
  const importRows = (rows: object[], userId = owner) =>
    world.call('POST', importUrl(), userId, { centerId: center.centerId, body: { rows } });

  beforeAll(async () => {
    application = await createTestApplication();
    world = new BookingWorld(application);
    prisma = application.get(PrismaService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    owner = await world.fixtures.createUser('owner');
    center = await world.createCenter(owner);
  });

  afterAll(async () => {
    await application.close();
  });

  it('creates unactivated accounts with a client membership and reports skipped rows', async () => {
    const response = await importRows([
      { fullName: 'Ana Pérez', email: 'Ana@Import.test', phone: '600111222', level: 'beginner' },
      { fullName: 'Sin correo', email: '' },
      { fullName: 'Ana repetida', email: 'ana@import.test' },
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.json<ImportReportBody>()).toEqual({
      createdCount: 1,
      updatedCount: 0,
      skipped: [
        { rowNumber: 2, email: null, reason: 'missing_email' },
        { rowNumber: 3, email: 'ana@import.test', reason: 'duplicated_in_file' },
      ],
    });
    const account = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@import.test' } });
    expect(account.emailVerifiedAt).toBeNull();
    expect(account.phone).toBe('600111222');
    const memberships = await inCenter((client) =>
      client.membership.findMany({ where: { userId: account.id } }),
    );
    expect(memberships).toMatchObject([
      { centerId: center.centerId, role: 'client', status: 'active', level: 'beginner' },
    ]);
  });

  it('updates the level of someone who is already a client instead of duplicating them', async () => {
    await importRows([{ fullName: 'Ana', email: 'ana@import.test' }]);

    const response = await importRows([
      { fullName: 'Ana otra vez', email: 'ana@import.test', level: 'advanced' },
    ]);

    expect(response.json<ImportReportBody>()).toMatchObject({ createdCount: 0, updatedCount: 1 });
    const clients = await inCenter((client) =>
      client.membership.findMany({ where: { role: 'client' } }),
    );
    expect(clients).toMatchObject([{ level: 'advanced' }]);
  });

  it('does not touch blocked clients or members of the team', async () => {
    const staff = await world.addMember(center.centerId, 'staff', 'staff');
    const blockedUserId = await world.fixtures.createUser('blocked');
    await world.fixtures.createMembership({
      centerId: center.centerId,
      userId: blockedUserId,
      role: 'client',
      status: 'blocked',
    });

    const response = await importRows([
      { fullName: 'Equipo', email: 'staff@example.test' },
      { fullName: 'Bloqueado', email: 'blocked@example.test' },
    ]);

    expect(response.json<ImportReportBody>()).toMatchObject({
      createdCount: 0,
      skipped: [
        { rowNumber: 1, reason: 'team_member' },
        { rowNumber: 2, reason: 'blocked' },
      ],
    });
    const unchanged = await inCenter((client) =>
      client.membership.findUniqueOrThrow({ where: { id: staff.membershipId } }),
    );
    expect(unchanged.role).toBe('staff');
  });

  it('stops creating clients once the plan limit is reached', async () => {
    await inCenter((client) =>
      client.center.update({ where: { id: center.centerId }, data: { maxClients: 1 } }),
    );

    const response = await importRows([
      { fullName: 'Primera', email: 'one@import.test' },
      { fullName: 'Segunda', email: 'two@import.test' },
    ]);

    expect(response.json<ImportReportBody>()).toMatchObject({
      createdCount: 1,
      skipped: [{ rowNumber: 2, email: 'two@import.test', reason: 'client_limit_reached' }],
    });
  });

  it('records the import in the activity log', async () => {
    await importRows([{ fullName: 'Ana', email: 'ana@import.test' }]);

    const entries = await inCenter((client) =>
      client.activityLog.findMany({ where: { kind: 'clients_imported' } }),
    );

    expect(entries).toMatchObject([{ subject: '1' }]);
  });

  it.each([
    ['an empty list', []],
    ['a row without name', [{ fullName: '', email: 'a@import.test' }]],
    ['an invalid email', [{ fullName: 'Ana', email: 'no-es-un-correo' }]],
    ['an unknown level', [{ fullName: 'Ana', email: 'a@import.test', level: 'expert' }]],
  ])('rejects %s', async (_caseName, rows) => {
    const response = await importRows(rows);

    expect(response.statusCode).toBe(400);
  });

  it('is only for owners and admins', async () => {
    const staff = await world.addMember(center.centerId, 'staff', 'staff');
    const client = await world.addMember(center.centerId, 'client', 'client');
    const rows = [{ fullName: 'Ana', email: 'ana@import.test' }];

    expect((await importRows(rows, staff.userId)).statusCode).toBe(403);
    expect((await importRows(rows, client.userId)).statusCode).toBe(403);
  });
});
