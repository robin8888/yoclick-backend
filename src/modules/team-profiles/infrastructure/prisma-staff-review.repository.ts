import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type ReviewNotificationData } from '../../notifications/domain/notification-rules';
import {
  type CreateStaffReviewOutcome,
  type ModerateStaffReviewOutcome,
  type StaffReviewRepository,
  type StaffReviewView,
} from '../application/ports/staff-review.repository';

const REVIEW_SELECT = {
  id: true,
  staffMembershipId: true,
  rating: true,
  comment: true,
  status: true,
  createdAt: true,
  staff: { select: { user: { select: { fullName: true } } } },
  client: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.StaffReviewSelect;

type ReviewRow = Prisma.StaffReviewGetPayload<{ select: typeof REVIEW_SELECT }>;

/** «Marta Ruiz Gil» → «Marta R.» */
function buildAuthorLabel(fullName: string): string {
  const [firstName = '', surname] = fullName.trim().split(/\s+/);
  return surname ? `${firstName} ${surname.charAt(0).toUpperCase()}.` : firstName;
}

function toView(row: ReviewRow): StaffReviewView {
  return {
    id: row.id,
    staffMembershipId: row.staffMembershipId,
    staffName: row.staff.user.fullName,
    authorLabel: buildAuthorLabel(row.client.user.fullName),
    rating: row.rating,
    comment: row.comment,
    status: row.status,
    createdAt: row.createdAt,
  };
}

async function noticeStaffOfReview(
  client: TenantTransactionClient,
  actor: ActorContext,
  review: StaffReviewView,
): Promise<void> {
  const noticeData: ReviewNotificationData = {
    authorLabel: review.authorLabel,
    rating: String(review.rating),
  };
  await client.notification.create({
    data: {
      id: generateUuidV7(),
      centerId: actor.centerId,
      recipientMembershipId: review.staffMembershipId,
      kind: 'staff_review_received',
      data: noticeData,
    },
  });
}

/** La sesión más reciente con esa persona que ya ocurrió y todavía no tiene opinión. */
async function findEligibleBookingId(
  client: TenantTransactionClient,
  request: { clientMembershipId: string; staffMembershipId: string },
): Promise<string | null> {
  const booking = await client.booking.findFirst({
    where: {
      clientMembershipId: request.clientMembershipId,
      status: { not: 'cancelled' },
      classSession: { staffMembershipId: request.staffMembershipId },
      OR: [{ checkedInAt: { not: null } }, { endedAt: { not: null } }],
      staffReview: null,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return booking?.id ?? null;
}

@Injectable()
export class PrismaStaffReviewRepository implements StaffReviewRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async create(
    actor: ActorContext,
    review: {
      id: string;
      staffMembershipId: string;
      rating: number;
      comment: string | null;
      status: 'pending' | 'published';
    },
  ): Promise<CreateStaffReviewOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const bookingId = await findEligibleBookingId(client, {
        clientMembershipId: actor.membershipId,
        staffMembershipId: review.staffMembershipId,
      });
      if (bookingId === null) return { kind: 'not_eligible' } as const;
      const saved = await client.staffReview.create({
        data: {
          ...review,
          centerId: actor.centerId,
          clientMembershipId: actor.membershipId,
          bookingId,
        },
        select: REVIEW_SELECT,
      });
      const view = toView(saved);
      if (view.status === 'published') await noticeStaffOfReview(client, actor, view);
      return { kind: 'created', review: view } as const;
    });
  }

  async listPublished(actor: ActorContext, staffMembershipId: string): Promise<StaffReviewView[]> {
    const rows = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.staffReview.findMany({
        where: { staffMembershipId, status: 'published' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: REVIEW_SELECT,
      }),
    );
    return rows.map(toView);
  }

  async listPending(actor: ActorContext): Promise<StaffReviewView[]> {
    const rows = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.staffReview.findMany({
        where: { status: 'pending' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: REVIEW_SELECT,
      }),
    );
    return rows.map(toView);
  }

  async moderate(
    actor: ActorContext,
    request: { reviewId: string; isApproved: boolean },
  ): Promise<ModerateStaffReviewOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const current = await client.staffReview.findUnique({
        where: { id: request.reviewId },
        select: { status: true },
      });
      if (!current) return { kind: 'not_found' } as const;
      if (current.status !== 'pending') return { kind: 'not_pending' } as const;
      const saved = await client.staffReview.update({
        where: { id: request.reviewId },
        data: {
          status: request.isApproved ? 'published' : 'rejected',
          moderatedAt: new Date(),
          moderatedByMembershipId: actor.membershipId,
        },
        select: REVIEW_SELECT,
      });
      const view = toView(saved);
      if (request.isApproved) await noticeStaffOfReview(client, actor, view);
      return { kind: 'moderated', review: view } as const;
    });
  }

  async readReviewsNeedApproval(actor: ActorContext): Promise<boolean> {
    const center = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.center.findUniqueOrThrow({
        where: { id: actor.centerId },
        select: { reviewsNeedApproval: true },
      }),
    );
    return center.reviewsNeedApproval;
  }
}
