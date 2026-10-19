import { type AddressInfo } from 'node:net';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import WebSocket from 'ws';
import { AccessTokenService } from '../../src/shared/auth/access-token.service';
import { BookingWorld, type CreatedTestCenter } from '../support/booking-world';
import { resetTestDatabase } from '../support/test-database';
import { createTestApplication } from './create-test-application';

const SILENCE_MS = 300;
const EVENT_TIMEOUT_MS = 3_000;
const CLOSE_UNAUTHENTICATED = 4401;

interface Person {
  userId: string;
  membershipId: string;
}

interface ServerEvent {
  type: string;
  conversationId?: string | null;
}

describe('realtime (WebSocket)', () => {
  let application: NestFastifyApplication;
  let world: BookingWorld;
  let tokens: AccessTokenService;
  let port: number;
  let ownerUserId: string;
  let center: CreatedTestCenter;
  let centerId: string;
  let teacher: Person;
  let ana: Person;
  let luis: Person;
  const openSockets: WebSocket[] = [];

  const url = (path: string): string => `/v1/centers/${centerId}${path}`;

  function open(path = '/v1/realtime'): WebSocket {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`);
    openSockets.push(socket);
    return socket;
  }

  function nextEvent(socket: WebSocket, timeoutMs = EVENT_TIMEOUT_MS): Promise<ServerEvent | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, timeoutMs);
      socket.once('message', (rawMessage) => {
        clearTimeout(timer);
        resolve(JSON.parse(Buffer.from(rawMessage as Buffer).toString('utf8')) as ServerEvent);
      });
    });
  }

  function nextClose(socket: WebSocket): Promise<number> {
    return new Promise((resolve) => {
      socket.once('close', (code) => {
        resolve(code);
      });
    });
  }

  async function connect(userId: string, forCenterId = centerId): Promise<WebSocket> {
    const socket = open();
    await new Promise<void>((resolve) => {
      socket.once('open', () => {
        resolve();
      });
    });
    const { token } = await tokens.issue(userId, { isMfaVerified: true });
    const ready = nextEvent(socket);
    socket.send(JSON.stringify({ type: 'auth', accessToken: token, centerId: forCenterId }));
    expect(await ready).toEqual({ type: 'ready' });
    return socket;
  }

  async function openConversation(person: Person, withMembershipId: string | null) {
    const opened = await world.call('POST', url('/conversations'), person.userId, {
      centerId,
      body: withMembershipId === null ? {} : { withMembershipId },
    });
    return opened.json<{ conversationId: string }>().conversationId;
  }

  const send = async (person: Person, conversationId: string, body: string) =>
    world.call('POST', url(`/conversations/${conversationId}/messages`), person.userId, {
      centerId,
      body: { body },
    });

  beforeAll(async () => {
    application = await createTestApplication();
    await application.listen(0, '127.0.0.1');
    port = (application.getHttpServer().address() as AddressInfo).port;
    world = new BookingWorld(application);
    tokens = application.get(AccessTokenService);
  });

  beforeEach(async () => {
    await resetTestDatabase();
    ownerUserId = await world.fixtures.createUser('owner');
    center = await world.createCenter(ownerUserId);
    centerId = center.centerId;
    teacher = await world.addMember(centerId, 'teacher', 'staff');
    ana = await world.addMember(centerId, 'ana', 'client');
    luis = await world.addMember(centerId, 'luis', 'client');
  });

  afterEach(() => {
    for (const socket of openSockets.splice(0)) socket.terminate();
  });

  afterAll(async () => {
    await application.close();
  });

  it('tells both people of a conversation, with no content, when a message arrives', async () => {
    const conversationId = await openConversation(ana, teacher.membershipId);
    const teacherSocket = await connect(teacher.userId);
    const anaSocket = await connect(ana.userId);
    const teacherEvent = nextEvent(teacherSocket);
    const anaEvent = nextEvent(anaSocket);

    await send(ana, conversationId, 'Hola profe, ¿mañana a las 18:00?');

    expect(await teacherEvent).toEqual({ type: 'chat.updated', conversationId });
    expect(await anaEvent).toEqual({ type: 'chat.updated', conversationId });
  });

  it('does not tell anyone else', async () => {
    const conversationId = await openConversation(ana, teacher.membershipId);
    const luisSocket = await connect(luis.userId);
    const silence = nextEvent(luisSocket, SILENCE_MS);

    await send(ana, conversationId, 'Esto es privado');

    expect(await silence).toBeNull();
  });

  it('tells the administration when someone writes to the center', async () => {
    const conversationId = await openConversation(ana, null);
    const ownerSocket = await connect(ownerUserId);
    const ownerEvent = nextEvent(ownerSocket);

    await send(ana, conversationId, 'Hola centro');

    expect(await ownerEvent).toEqual({ type: 'chat.updated', conversationId });
  });

  it('closes a connection that presents a bad token', async () => {
    const socket = open();
    await new Promise<void>((resolve) => {
      socket.once('open', () => {
        resolve();
      });
    });
    const closed = nextClose(socket);

    socket.send(JSON.stringify({ type: 'auth', accessToken: 'not-a-token', centerId }));

    expect(await closed).toBe(CLOSE_UNAUTHENTICATED);
  });

  it('closes a connection of someone who does not belong to that center', async () => {
    const otherOwnerId = await world.fixtures.createUser('other-owner');
    const otherCenter = await world.createCenter(otherOwnerId, 'Otro centro');
    const socket = open();
    await new Promise<void>((resolve) => {
      socket.once('open', () => {
        resolve();
      });
    });
    const closed = nextClose(socket);
    const { token } = await tokens.issue(ana.userId, { isMfaVerified: true });

    socket.send(
      JSON.stringify({ type: 'auth', accessToken: token, centerId: otherCenter.centerId }),
    );

    expect(await closed).toBe(CLOSE_UNAUTHENTICATED);
  });

  it('closes a connection whose first message is not an identification', async () => {
    const socket = open();
    await new Promise<void>((resolve) => {
      socket.once('open', () => {
        resolve();
      });
    });
    const closed = nextClose(socket);

    socket.send('hola');

    expect(await closed).toBe(CLOSE_UNAUTHENTICATED);
  });

  it('refuses any other path', async () => {
    const socket = open('/v1/other');

    const outcome = await new Promise<string>((resolve) => {
      socket.once('open', () => {
        resolve('open');
      });
      socket.once('error', () => {
        resolve('refused');
      });
    });

    expect(outcome).toBe('refused');
  });
});
