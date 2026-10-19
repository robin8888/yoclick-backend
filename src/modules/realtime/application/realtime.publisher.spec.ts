import { RealtimeConnections } from './realtime-connections';
import { RealtimePublisher } from './realtime.publisher';

describe('RealtimePublisher', () => {
  it('tells the people of a conversation, without any content, that it changed', () => {
    const connections = new RealtimeConnections();
    const anaSend = jest.fn();
    const outsiderSend = jest.fn();
    connections.register({ send: anaSend, close: jest.fn() }, ['center-1:ana']);
    connections.register({ send: outsiderSend, close: jest.fn() }, ['center-1:outsider']);

    new RealtimePublisher(connections).publishChatUpdated({
      centerId: 'center-1',
      membershipIds: ['ana'],
      conversationId: 'conversation-1',
    });

    expect(anaSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'chat.updated', conversationId: 'conversation-1' }),
    );
    expect(outsiderSend).not.toHaveBeenCalled();
  });

  it('does not reach the same membership id of another center', () => {
    const connections = new RealtimeConnections();
    const otherCenterSend = jest.fn();
    connections.register({ send: otherCenterSend, close: jest.fn() }, ['center-2:ana']);

    new RealtimePublisher(connections).publishChatUpdated({
      centerId: 'center-1',
      membershipIds: ['ana'],
      conversationId: null,
    });

    expect(otherCenterSend).not.toHaveBeenCalled();
  });
});
