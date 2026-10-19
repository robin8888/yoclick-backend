import { RealtimeConnections, type RealtimeSocket } from './realtime-connections';

interface SpySocket {
  socket: RealtimeSocket;
  send: jest.Mock;
  close: jest.Mock;
}

function buildSocket(): SpySocket {
  const send = jest.fn();
  const close = jest.fn();
  return { socket: { send, close }, send, close };
}

describe('RealtimeConnections', () => {
  it('sends only to the connections of the keys asked for', () => {
    const connections = new RealtimeConnections();
    const ana = buildSocket();
    const luis = buildSocket();
    connections.register(ana.socket, ['c1:ana']);
    connections.register(luis.socket, ['c1:luis']);

    connections.send(['c1:ana'], 'ping');

    expect(ana.send).toHaveBeenCalledWith('ping');
    expect(luis.send).not.toHaveBeenCalled();
  });

  it('sends once to a connection that matches several keys (a guardian and their children)', () => {
    const connections = new RealtimeConnections();
    const guardian = buildSocket();
    connections.register(guardian.socket, ['c1:guardian', 'c1:child']);

    connections.send(['c1:guardian', 'c1:child'], 'ping');

    expect(guardian.send).toHaveBeenCalledTimes(1);
  });

  it('forgets a connection once it is unregistered', () => {
    const connections = new RealtimeConnections();
    const ana = buildSocket();
    connections.register(ana.socket, ['c1:ana']);

    connections.unregister(ana.socket);
    connections.send(['c1:ana'], 'ping');

    expect(ana.send).not.toHaveBeenCalled();
    expect(connections.countFor('c1:ana')).toBe(0);
  });

  it('closes the oldest connection when a person opens too many', () => {
    const connections = new RealtimeConnections();
    const sockets = Array.from({ length: 6 }, buildSocket);
    for (const spy of sockets) connections.register(spy.socket, ['c1:ana']);

    expect(sockets[0]?.close).toHaveBeenCalledWith(4429, 'too_many_connections');
    expect(connections.countFor('c1:ana')).toBe(5);
  });
});
