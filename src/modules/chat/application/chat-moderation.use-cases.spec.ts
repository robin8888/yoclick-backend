import { type ActorContext, type MembershipRoleName } from '../../../shared/tenancy/actor-context';
import {
  BlockPersonUseCase,
  ListBlockedPeopleUseCase,
  ReportMessageUseCase,
  ReviewMessageReportUseCase,
  UnblockPersonUseCase,
} from './chat-moderation.use-cases';
import {
  type BlockedPersonView,
  type BlockTarget,
  type ChatModerationRepository,
  type CreatedMessageReport,
  type MessageReportView,
  type NewMessageReport,
  type ReportableMessage,
} from './ports/chat-moderation.repository';

const CENTER_ID = '0198a8a0-0000-7000-8000-000000000001';

function buildActor(membershipId: string, role: MembershipRoleName): ActorContext {
  return {
    userId: `user-${membershipId}`,
    centerId: CENTER_ID,
    membershipId,
    role,
    permissions: [],
  };
}

const ANA = buildActor('ana', 'client');
const TEACHER = buildActor('teacher', 'staff');
const OWNER = buildActor('owner', 'owner');

const PEOPLE: Readonly<Record<string, BlockTarget>> = {
  ana: { id: 'ana', role: 'client' },
  luis: { id: 'luis', role: 'client' },
  teacher: { id: 'teacher', role: 'staff' },
  owner: { id: 'owner', role: 'owner' },
  admin: { id: 'admin', role: 'admin' },
};

class InMemoryModerationRepository implements ChatModerationRepository {
  blocks = new Map<string, Set<string>>();
  messages = new Map<string, ReportableMessage>();
  reports: { reporterMembershipId: string; report: NewMessageReport }[] = [];
  reviewed = new Set<string>();

  findBlockTarget(_actor: ActorContext, membershipId: string): Promise<BlockTarget | null> {
    return Promise.resolve(PEOPLE[membershipId] ?? null);
  }

  listBlocks(actor: ActorContext): Promise<BlockedPersonView[]> {
    const blocked = [...(this.blocks.get(actor.membershipId) ?? [])];
    return Promise.resolve(
      blocked.map((id) => ({
        membershipId: id,
        fullName: id,
        role: PEOPLE[id]?.role ?? 'client',
        photoKey: null,
        blockedAt: new Date('2026-10-28T10:00:00Z'),
      })),
    );
  }

  async addBlock(actor: ActorContext, blockedMembershipId: string): Promise<BlockedPersonView> {
    const blocked = this.blocks.get(actor.membershipId) ?? new Set<string>();
    blocked.add(blockedMembershipId);
    this.blocks.set(actor.membershipId, blocked);
    const [view] = (await this.listBlocks(actor)).filter(
      ({ membershipId }) => membershipId === blockedMembershipId,
    );
    if (view === undefined) throw new Error('The block was not stored');
    return view;
  }

  removeBlock(actor: ActorContext, blockedMembershipId: string): Promise<void> {
    this.blocks.get(actor.membershipId)?.delete(blockedMembershipId);
    return Promise.resolve();
  }

  findReportableMessage(
    _actor: ActorContext,
    request: { conversationId: string; messageId: string },
  ): Promise<ReportableMessage | null> {
    return Promise.resolve(this.messages.get(request.messageId) ?? null);
  }

  createReport(actor: ActorContext, report: NewMessageReport): Promise<CreatedMessageReport> {
    const existing = this.reports.find(
      (stored) =>
        stored.reporterMembershipId === actor.membershipId &&
        stored.report.message.id === report.message.id,
    );
    if (existing !== undefined) {
      return Promise.resolve({ reportId: existing.report.id, status: 'open', isNew: false });
    }
    this.reports.push({ reporterMembershipId: actor.membershipId, report });
    return Promise.resolve({ reportId: report.id, status: 'open', isNew: true });
  }

  listReports(): Promise<MessageReportView[]> {
    return Promise.resolve([]);
  }

  reviewReport(
    _actor: ActorContext,
    request: { reportId: string; reviewedAt: Date },
  ): Promise<MessageReportView | null> {
    const stored = this.reports.find(({ report }) => report.id === request.reportId);
    if (stored === undefined) return Promise.resolve(null);
    this.reviewed.add(request.reportId);
    return Promise.resolve({
      id: request.reportId,
      reason: stored.report.reason,
      details: stored.report.details,
      status: 'reviewed',
      reporterName: stored.reporterMembershipId,
      reportedSenderName: stored.report.message.senderMembershipId,
      reportedBody: stored.report.message.body,
      reportedAttachmentName: null,
      createdAt: new Date('2026-10-28T10:00:00Z'),
      reviewedAt: request.reviewedAt,
    });
  }
}

describe('BlockPersonUseCase', () => {
  let repository: InMemoryModerationRepository;
  let useCase: BlockPersonUseCase;

  beforeEach(() => {
    repository = new InMemoryModerationRepository();
    useCase = new BlockPersonUseCase(repository);
  });

  it.each([
    { name: 'a client blocks a teacher', actor: ANA, target: 'teacher' },
    { name: 'a teacher blocks a client', actor: TEACHER, target: 'ana' },
  ])('stores the block when $name', async ({ actor, target }) => {
    const view = await useCase.execute(actor, target);

    expect(view.membershipId).toBe(target);
    expect(repository.blocks.get(actor.membershipId)).toEqual(new Set([target]));
  });

  it.each([
    { name: 'blocks themselves', actor: ANA, target: 'ana' },
    { name: 'blocks another client', actor: ANA, target: 'luis' },
    { name: 'blocks the owner', actor: ANA, target: 'owner' },
    { name: 'blocks an administrator', actor: TEACHER, target: 'admin' },
    { name: 'is the owner and blocks a client', actor: OWNER, target: 'ana' },
  ])('refuses when someone $name', async ({ actor, target }) => {
    await expect(useCase.execute(actor, target)).rejects.toMatchObject({
      code: 'CHAT_BLOCK_NOT_ALLOWED',
      httpStatus: 403,
    });
    expect(repository.blocks.size).toBe(0);
  });

  it('answers 404 when the person does not exist in the center', async () => {
    await expect(useCase.execute(ANA, 'nobody')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('does not fail or duplicate when the person was already blocked', async () => {
    await useCase.execute(ANA, 'teacher');
    await useCase.execute(ANA, 'teacher');

    const list = await new ListBlockedPeopleUseCase(repository).execute(ANA);
    expect(list.map(({ membershipId }) => membershipId)).toEqual(['teacher']);
  });
});

describe('UnblockPersonUseCase', () => {
  it('removes the block and does not fail when there was none', async () => {
    const repository = new InMemoryModerationRepository();
    await new BlockPersonUseCase(repository).execute(ANA, 'teacher');
    const unblock = new UnblockPersonUseCase(repository);

    await unblock.execute(ANA, 'teacher');
    await expect(unblock.execute(ANA, 'teacher')).resolves.toBeUndefined();

    expect(repository.blocks.get('ana')?.size).toBe(0);
  });
});

describe('ReportMessageUseCase', () => {
  let repository: InMemoryModerationRepository;
  let useCase: ReportMessageUseCase;
  const request = {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    reason: 'harassment' as const,
    details: null,
  };

  beforeEach(() => {
    repository = new InMemoryModerationRepository();
    repository.messages.set('message-1', {
      id: 'message-1',
      senderMembershipId: 'teacher',
      body: 'Un mensaje que no debería haber enviado',
      attachmentName: null,
    });
    useCase = new ReportMessageUseCase(repository);
  });

  it('stores the report with a copy of the reported message', async () => {
    const created = await useCase.execute(ANA, request);

    expect(created).toMatchObject({ status: 'open', isNew: true });
    expect(repository.reports).toHaveLength(1);
    expect(repository.reports[0]?.report.message.body).toBe(
      'Un mensaje que no debería haber enviado',
    );
    expect(repository.reports[0]?.report).toMatchObject({ reason: 'harassment', details: null });
  });

  it('answers 404 when the message is not visible to the reporter or does not exist', async () => {
    await expect(
      useCase.execute(ANA, { ...request, messageId: 'someone-elses-message' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
    expect(repository.reports).toHaveLength(0);
  });

  it('does not let the author report their own message', async () => {
    await expect(useCase.execute(TEACHER, request)).rejects.toMatchObject({
      code: 'CHAT_CANNOT_REPORT_OWN_MESSAGE',
      httpStatus: 403,
    });
    expect(repository.reports).toHaveLength(0);
  });

  it('does not duplicate the report when the same person reports the same message again', async () => {
    await useCase.execute(ANA, request);

    const again = await useCase.execute(ANA, request);

    expect(again.isNew).toBe(false);
    expect(repository.reports).toHaveLength(1);
  });
});

describe('ReviewMessageReportUseCase', () => {
  it('marks the report as reviewed and answers 404 when it does not exist', async () => {
    const repository = new InMemoryModerationRepository();
    repository.messages.set('message-1', {
      id: 'message-1',
      senderMembershipId: 'teacher',
      body: 'Texto',
      attachmentName: null,
    });
    const created = await new ReportMessageUseCase(repository).execute(ANA, {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      reason: 'spam',
      details: null,
    });
    const review = new ReviewMessageReportUseCase(repository);

    const reviewed = await review.execute(OWNER, created.reportId);

    expect(reviewed.status).toBe('reviewed');
    await expect(review.execute(OWNER, 'missing-report')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
