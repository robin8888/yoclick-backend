import { Injectable } from '@nestjs/common';
import { v7 as generateUuidV7 } from 'uuid';
import { type Prisma } from '../../../generated/prisma/client';
import {
  TenantPrismaService,
  type TenantTransactionClient,
} from '../../../shared/database/tenant-prisma.service';
import { type ActorContext } from '../../../shared/tenancy/actor-context';
import { type ProfileNotificationData } from '../../notifications/domain/notification-rules';
import { VIDEO_SELECT } from '../../videos/infrastructure/video-select';
import {
  type AddCertificationOutcome,
  type ProfileContent,
  type ProfileView,
  type ReviewProfileOutcome,
  type TeamProfileRepository,
  type TeamSettings,
} from '../application/ports/team-profile.repository';
import { MAX_CERTIFICATIONS, summarizeRatings } from '../domain/profile-rules';

const MEMBER_SELECT = {
  id: true,
  role: true,
  staffTitle: true,
  user: { select: { fullName: true } },
  profileVideo: { select: VIDEO_SELECT },
  techniqueVideos: { orderBy: { createdAt: 'asc' }, select: VIDEO_SELECT },
  staffProfile: {
    select: {
      headline: true,
      bio: true,
      specialties: true,
      languages: true,
      status: true,
      reviewNote: true,
      publishConsentAt: true,
      certifications: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, detail: true, verifiedAt: true },
      },
    },
  },
} satisfies Prisma.MembershipSelect;

type MemberRow = Prisma.MembershipGetPayload<{ select: typeof MEMBER_SELECT }>;

const TEAM_ROLES = ['owner', 'admin', 'staff'] as const;

const NO_PROFILE_YET = {
  headline: null,
  bio: null,
  specialties: [],
  languages: [],
  status: 'draft',
  reviewNote: null,
  publishConsentAt: null,
  certifications: [],
} as const;

function toProfileView(member: MemberRow, ratings: readonly number[]): ProfileView {
  const profile = member.staffProfile ?? NO_PROFILE_YET;
  return {
    membershipId: member.id,
    role: member.role as ProfileView['role'],
    fullName: member.user.fullName,
    staffTitle: member.staffTitle,
    headline: profile.headline,
    bio: profile.bio,
    specialties: profile.specialties,
    languages: profile.languages,
    status: profile.status,
    reviewNote: profile.reviewNote,
    hasPublishConsent: profile.publishConsentAt !== null,
    certifications: profile.certifications.map(({ verifiedAt, ...certification }) => ({
      ...certification,
      isVerified: verifiedAt !== null,
    })),
    introVideo: member.profileVideo,
    techniqueVideos: member.techniqueVideos,
    rating: summarizeRatings(ratings),
  };
}

async function readName(client: TenantTransactionClient, membershipId: string): Promise<string> {
  const member = await client.membership.findUnique({
    where: { id: membershipId },
    select: { user: { select: { fullName: true } } },
  });
  return member?.user.fullName ?? '';
}

async function recordNotices(
  client: TenantTransactionClient,
  request: {
    actor: ActorContext;
    kind: 'staff_profile_submitted' | 'staff_profile_reviewed';
    recipientMembershipIds: readonly string[];
    staffMembershipId: string;
    outcome?: string;
  },
): Promise<void> {
  const recipients = request.recipientMembershipIds.filter(
    (membershipId) => membershipId !== request.actor.membershipId,
  );
  if (recipients.length === 0) return;
  const noticeData: ProfileNotificationData = {
    staffName: await readName(client, request.staffMembershipId),
    actorName: await readName(client, request.actor.membershipId),
    ...(request.outcome !== undefined && { outcome: request.outcome }),
  };
  await client.notification.createMany({
    data: recipients.map((recipientMembershipId) => ({
      id: generateUuidV7(),
      centerId: request.actor.centerId,
      recipientMembershipId,
      kind: request.kind,
      data: noticeData,
    })),
  });
}

async function findAdministratorIds(client: TenantTransactionClient): Promise<string[]> {
  const administrators = await client.membership.findMany({
    where: { role: { in: ['owner', 'admin'] }, status: 'active' },
    select: { id: true },
  });
  return administrators.map(({ id }) => id);
}

async function loadPublishedRatings(
  client: TenantTransactionClient,
): Promise<Map<string, number[]>> {
  const reviews = await client.staffReview.findMany({
    where: { status: 'published' },
    select: { staffMembershipId: true, rating: true },
  });
  const ratingsByStaff = new Map<string, number[]>();
  for (const { staffMembershipId, rating } of reviews) {
    ratingsByStaff.set(staffMembershipId, [
      ...(ratingsByStaff.get(staffMembershipId) ?? []),
      rating,
    ]);
  }
  return ratingsByStaff;
}

@Injectable()
export class PrismaTeamProfileRepository implements TeamProfileRepository {
  constructor(private readonly tenantPrismaService: TenantPrismaService) {}

  async listProfiles(actor: ActorContext): Promise<ProfileView[]> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const members = await client.membership.findMany({
        where: { role: { in: [...TEAM_ROLES] }, status: 'active' },
        orderBy: { joinedAt: 'asc' },
        select: MEMBER_SELECT,
      });
      const ratings = await loadPublishedRatings(client);
      return members.map((member) => toProfileView(member, ratings.get(member.id) ?? []));
    });
  }

  async findProfile(actor: ActorContext, membershipId: string): Promise<ProfileView | null> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const member = await client.membership.findFirst({
        where: { id: membershipId, role: { in: [...TEAM_ROLES] }, status: 'active' },
        select: MEMBER_SELECT,
      });
      if (!member) return null;
      const ratings = await loadPublishedRatings(client);
      return toProfileView(member, ratings.get(member.id) ?? []);
    });
  }

  async saveContent(actor: ActorContext, content: ProfileContent): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const existing = await client.staffProfile.findUnique({
        where: { membershipId: actor.membershipId },
        select: { publishConsentAt: true },
      });
      const publishConsentAt = content.hasPublishConsent
        ? (existing?.publishConsentAt ?? new Date())
        : null;
      const profileFields = {
        headline: content.headline,
        bio: content.bio,
        specialties: [...content.specialties],
        languages: [...content.languages],
        publishConsentAt,
        status: 'draft' as const,
      };
      await client.staffProfile.upsert({
        where: { membershipId: actor.membershipId },
        create: { ...profileFields, membershipId: actor.membershipId, centerId: actor.centerId },
        update: profileFields,
      });
    });
  }

  async submit(actor: ActorContext, status: 'pending' | 'published'): Promise<void> {
    await this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const now = new Date();
      await client.staffProfile.upsert({
        where: { membershipId: actor.membershipId },
        create: { membershipId: actor.membershipId, centerId: actor.centerId, status },
        update: {
          status,
          submittedAt: now,
          reviewNote: null,
          ...(status === 'published' && {
            reviewedAt: now,
            reviewedByMembershipId: actor.membershipId,
          }),
        },
      });
      if (status !== 'pending') return;
      await recordNotices(client, {
        actor,
        kind: 'staff_profile_submitted',
        recipientMembershipIds: await findAdministratorIds(client),
        staffMembershipId: actor.membershipId,
      });
    });
  }

  async review(
    actor: ActorContext,
    request: { membershipId: string; isApproved: boolean; note: string | null },
  ): Promise<ReviewProfileOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const profile = await client.staffProfile.findUnique({
        where: { membershipId: request.membershipId },
        select: { status: true },
      });
      if (!profile) return { kind: 'not_found' } as const;
      if (profile.status !== 'pending') return { kind: 'not_pending' } as const;
      await client.staffProfile.update({
        where: { membershipId: request.membershipId },
        data: {
          status: request.isApproved ? 'published' : 'changes_requested',
          reviewNote: request.isApproved ? null : request.note,
          reviewedAt: new Date(),
          reviewedByMembershipId: actor.membershipId,
        },
      });
      await recordNotices(client, {
        actor,
        kind: 'staff_profile_reviewed',
        recipientMembershipIds: [request.membershipId],
        staffMembershipId: request.membershipId,
        outcome: request.isApproved ? 'approved' : 'changes_requested',
      });
      return { kind: 'reviewed' } as const;
    });
  }

  async addCertification(
    actor: ActorContext,
    certification: { id: string; name: string; detail: string | null },
  ): Promise<AddCertificationOutcome> {
    return this.tenantPrismaService.runInTenantContext(actor, async (client) => {
      const count = await client.staffCertification.count({
        where: { membershipId: actor.membershipId },
      });
      if (count >= MAX_CERTIFICATIONS) return { kind: 'limit_reached' } as const;
      await client.staffProfile.upsert({
        where: { membershipId: actor.membershipId },
        create: { membershipId: actor.membershipId, centerId: actor.centerId, status: 'draft' },
        update: { status: 'draft' },
      });
      await client.staffCertification.create({
        data: { ...certification, centerId: actor.centerId, membershipId: actor.membershipId },
      });
      return { kind: 'added' } as const;
    });
  }

  async removeCertification(actor: ActorContext, certificationId: string): Promise<boolean> {
    const result = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.staffCertification.deleteMany({
        where: { id: certificationId, membershipId: actor.membershipId },
      }),
    );
    return result.count === 1;
  }

  async verifyCertification(actor: ActorContext, certificationId: string): Promise<boolean> {
    const result = await this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.staffCertification.updateMany({
        where: { id: certificationId, verifiedAt: null },
        data: { verifiedAt: new Date(), verifiedByMembershipId: actor.membershipId },
      }),
    );
    return result.count === 1;
  }

  async readSettings(actor: ActorContext): Promise<TeamSettings> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.center.findUniqueOrThrow({
        where: { id: actor.centerId },
        select: { showTeamOnWeb: true, reviewsNeedApproval: true },
      }),
    );
  }

  async saveSettings(actor: ActorContext, settings: Partial<TeamSettings>): Promise<TeamSettings> {
    return this.tenantPrismaService.runInTenantContext(actor, (client) =>
      client.center.update({
        where: { id: actor.centerId },
        data: settings,
        select: { showTeamOnWeb: true, reviewsNeedApproval: true },
      }),
    );
  }
}
