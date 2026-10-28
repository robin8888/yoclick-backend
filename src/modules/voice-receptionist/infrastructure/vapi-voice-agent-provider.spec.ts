import { VapiVoiceAgentProvider } from './vapi-voice-agent-provider';

const SECRET = 'a-long-shared-secret';

const toolMessage = {
  message: {
    type: 'tool-calls',
    call: {
      id: 'call-1',
      phoneNumber: { number: '+34 910 000 001' },
      customer: { number: '600 11 22 33' },
    },
    toolCallList: [
      {
        id: 'tool-1',
        type: 'function',
        function: { name: 'identifyCaller', arguments: { studentCode: '123456' } },
      },
    ],
  },
};

const transferRequest = {
  message: {
    type: 'transfer-destination-request',
    call: { id: 'call-1' },
    phoneNumber: { number: '+34910000001' },
    customer: { number: '+34600112233' },
  },
};

const endMessage = {
  message: {
    type: 'end-of-call-report',
    call: {
      id: 'call-1',
      phoneNumber: { number: '+34910000001' },
      customer: { number: '+34600112233' },
      startedAt: '2026-10-28T10:00:00.000Z',
      endedAt: '2026-10-28T10:02:01.000Z',
    },
    summary: 'Reserva',
    transcript: 'Hola',
    cost: 0.42,
  },
};

describe('VapiVoiceAgentProvider', () => {
  const provider = new VapiVoiceAgentProvider(SECRET);

  describe('isWebhookAuthentic', () => {
    it.each([
      { name: 'the right secret', headers: { 'x-vapi-secret': SECRET }, expected: true },
      { name: 'a wrong secret', headers: { 'x-vapi-secret': 'nope' }, expected: false },
      {
        name: 'a secret of another length',
        headers: { 'x-vapi-secret': `${SECRET}x` },
        expected: false,
      },
      { name: 'no secret', headers: {}, expected: false },
      {
        name: 'the secret as a bearer token',
        headers: { authorization: `Bearer ${SECRET}` },
        expected: true,
      },
      {
        name: 'a wrong bearer token',
        headers: { authorization: 'Bearer nope' },
        expected: false,
      },
      {
        name: 'the secret without the bearer prefix',
        headers: { authorization: SECRET },
        expected: false,
      },
      {
        name: 'a repeated header',
        headers: { 'x-vapi-secret': [SECRET, 'other'] },
        expected: true,
      },
    ])('is $expected with $name', ({ headers, expected }) => {
      expect(provider.isWebhookAuthentic(headers)).toBe(expected);
    });
  });

  describe('parseToolInvocation', () => {
    it('reads the call, the tool order and both numbers in E.164', () => {
      expect(provider.parseToolInvocation(toolMessage)).toEqual({
        providerCallId: 'call-1',
        toolCallId: 'tool-1',
        calledNumber: '+34910000001',
        callerNumber: '+34600112233',
        rawArguments: { studentCode: '123456' },
      });
    });

    it('reads the arguments when Vapi sends them as JSON text', () => {
      const asText = {
        message: {
          ...toolMessage.message,
          toolCallList: [
            {
              id: 'tool-1',
              function: { name: 'identifyCaller', arguments: '{"studentCode":"1"}' },
            },
          ],
        },
      };

      expect(provider.parseToolInvocation(asText)?.rawArguments).toEqual({ studentCode: '1' });
    });

    it('reads the numbers from the message when the call does not carry them', () => {
      const numbersOutsideCall = {
        message: {
          ...toolMessage.message,
          call: { id: 'call-1' },
          phoneNumber: { number: '+34910000001' },
          customer: { number: '+34600112233' },
        },
      };

      expect(provider.parseToolInvocation(numbersOutsideCall)).toMatchObject({
        calledNumber: '+34910000001',
        callerNumber: '+34600112233',
      });
    });

    it.each([
      {
        name: 'another message type',
        body: { message: { ...toolMessage.message, type: 'status-update' } },
      },
      { name: 'no tool orders', body: { message: { ...toolMessage.message, toolCallList: [] } } },
      {
        name: 'an unreadable called number',
        body: { message: { ...toolMessage.message, call: { id: 'c' } } },
      },
      { name: 'not an object', body: 'hello' },
    ])('returns null for $name', ({ body }) => {
      expect(provider.parseToolInvocation(body)).toBeNull();
    });
  });

  describe('parseCallEnd', () => {
    it('reads duration, summary, transcript and the cost in cents', () => {
      expect(provider.parseCallEnd(endMessage)).toMatchObject({
        providerCallId: 'call-1',
        durationSeconds: 121,
        summary: 'Reserva',
        transcript: 'Hola',
        estimatedCostCents: 42,
      });
    });

    it('reads the summary and the transcript from analysis and artifact', () => {
      const newerFormat = {
        message: {
          ...endMessage.message,
          summary: undefined,
          transcript: undefined,
          analysis: { summary: 'Cancelación' },
          artifact: { transcript: 'AI: Hola' },
        },
      };

      expect(provider.parseCallEnd(newerFormat)).toMatchObject({
        summary: 'Cancelación',
        transcript: 'AI: Hola',
      });
    });

    it('returns null without the call times', () => {
      const withoutTimes = { message: { ...endMessage.message, call: { id: 'call-1' } } };

      expect(provider.parseCallEnd(withoutTimes)).toBeNull();
    });
  });

  describe('buildToolResponse', () => {
    it('answers in the format Vapi expects, with the result as text', () => {
      expect(provider.buildToolResponse('tool-1', { result: { ok: true } })).toEqual({
        results: [{ toolCallId: 'tool-1', result: '{"ok":true}' }],
      });
    });

    it('keeps the result on one line even when the text has line breaks', () => {
      const response = provider.buildToolResponse('tool-1', { result: { message: 'a\nb' } });

      expect(JSON.stringify(response)).not.toContain('\n');
    });
  });

  describe('transfer destination request', () => {
    it('reads the call and both numbers', () => {
      expect(provider.parseTransferDestinationRequest(transferRequest)).toMatchObject({
        providerCallId: 'call-1',
        calledNumber: '+34910000001',
        callerNumber: '+34600112233',
      });
    });

    it('returns null for another message type', () => {
      const other = { message: { ...transferRequest.message, type: 'tool-calls' } };

      expect(provider.parseTransferDestinationRequest(other)).toBeNull();
    });

    it('answers with the destination when there is somebody to hand the call to', () => {
      const response = provider.buildTransferDestinationResponse({
        result: { ok: true },
        transferToNumber: '+34600998877',
      });

      expect(response).toEqual({ destination: { type: 'number', number: '+34600998877' } });
    });

    it('answers with an error the assistant can read when there is nobody', () => {
      const response = provider.buildTransferDestinationResponse({
        result: { ok: false, message: 'Ahora no hay nadie.' },
      });

      expect(response).toEqual({ error: 'Ahora no hay nadie.' });
    });
  });
});
