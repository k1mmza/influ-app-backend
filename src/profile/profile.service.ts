import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ─── GET PROFILE ─────────────────────────────────────────────────────────────
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: true,
        agencyProfile: true,
        influencerProfile: {
          include: {
            platformAccounts: {
              include: { audienceInsights: true },
            },
            rateCards: true,
            pastCollaborations: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    // Pick the right profile based on role
    let profile: any = null;
    if (user.role === 'BRAND') profile = user.brandProfile;
    else if (user.role === 'AGENCY') profile = user.agencyProfile;
    else if (user.role === 'INFLUENCER') profile = user.influencerProfile;

    // rateCardFileUrl is a private storage path — hand the caller a short-lived
    // signed URL instead of the raw path.
    if (profile?.rateCardFileUrl) {
      profile = {
        ...profile,
        rateCardFileUrl: await this.storage.signPrivate(profile.rateCardFileUrl),
      };
    }

    // Expose platform accounts with stats — no raw tokens
    const platforms =
      user.role === 'INFLUENCER' && user.influencerProfile?.platformAccounts
        ? user.influencerProfile.platformAccounts.map((pa) => ({
            id: pa.id,
            platform: pa.platform,
            handle: pa.handle,
            displayName: pa.displayName,
            followers: pa.followers,
            avgViews: pa.avgViews,
            engagementRate: pa.engagementRate,
            syncedAt: pa.syncedAt,
            hasTokens: !!(pa as any).refreshToken,
            needsReauth: pa.needsReauth,
          }))
        : [];

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan,
      profileCompleteness: user.profileCompleteness,
      avatarUrl: user.avatarUrl ?? null,
      profile,
      platforms,
    };
  }

  // ─── UPDATE PROFILE ───────────────────────────────────────────────────────────
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundException('User not found');

    await this.prisma.$transaction(async (tx) => {
      // 1. Update shared user fields (name, avatarUrl)
      const userUpdates: Record<string, any> = {};
      if (dto.name !== undefined) userUpdates.name = dto.name;
      if (dto.avatarUrl !== undefined)
        userUpdates.avatarUrl = dto.avatarUrl || null;
      if (Object.keys(userUpdates).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userUpdates });
      }

      // 2. Update role-specific profile
      if (user.role === 'BRAND' && dto.profile) {
        await tx.brandProfile.upsert({
          where: { userId },
          create: {
            userId,
            ...dto.profile,
            socialLinks: dto.profile.socialLinks as any,
          },
          update: {
            ...dto.profile,
            socialLinks: dto.profile.socialLinks as any,
          },
        });
      }

      if (user.role === 'AGENCY' && dto.profile) {
        await tx.agencyProfile.upsert({
          where: { userId },
          create: {
            userId,
            ...dto.profile,
            socialLinks: dto.profile.socialLinks as any,
          },
          update: {
            ...dto.profile,
            socialLinks: dto.profile.socialLinks as any,
          },
        });
      }

      if (user.role === 'INFLUENCER' && dto.influencerProfile) {
        const { rateCard, mediaKitAudience, ...rest } = dto.influencerProfile;
        // mediaKitAudience is a validated class instance; Prisma's Json input
        // wants a plain object, so spread it into one when present.
        const influencerFields: any = {
          ...rest,
          ...(mediaKitAudience !== undefined
            ? { mediaKitAudience: { ...mediaKitAudience } }
            : {}),
        };

        // 2a. Upsert influencer profile
        const influencerProfile = await tx.influencerProfile.upsert({
          where: { userId },
          create: { userId, ...influencerFields },
          update: influencerFields,
        });

        // 2b. Upsert rate card if provided
        if (rateCard) {
          const existing = await tx.rateCard.findFirst({
            where: { influencerId: influencerProfile.id },
          });

          if (existing) {
            await tx.rateCard.update({
              where: { id: existing.id },
              data: rateCard,
            });
          } else {
            await tx.rateCard.create({
              data: { influencerId: influencerProfile.id, ...rateCard },
            });
          }
        }
      }

      // 3. Recalculate profile completeness after update
      const completeness = await this.calculateCompleteness(userId, tx);
      await tx.user.update({
        where: { id: userId },
        data: { profileCompleteness: completeness },
      });
    });

    return this.getProfile(userId);
  }

  // ─── UPLOAD AVATAR ────────────────────────────────────────────────────────────
  // Public asset: store the absolute public URL. Replace = upload new, repoint the
  // DB, then best-effort delete the old object so it doesn't orphan.
  async uploadAvatarFile(userId: string, file: Express.Multer.File) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    const objectPath = `avatars/${this.storage.buildFilename(file.originalname)}`;
    const avatarUrl = await this.storage.uploadPublic(
      objectPath,
      file.buffer,
      file.mimetype,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });

    await this.storage.deletePublicByUrl(existing?.avatarUrl);
    return { avatarUrl };
  }

  // ─── UPLOAD RATE CARD FILE ────────────────────────────────────────────────────
  // Private file: store the storage path (signed on read). Replace deletes the old.
  async uploadRateCardFile(userId: string, file: Express.Multer.File) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'INFLUENCER')
      throw new ForbiddenException('Only influencers can upload a rate card');

    const profile = await this.prisma.influencerProfile.findUnique({
      where: { userId },
    });
    if (!profile)
      throw new BadRequestException(
        'Influencer profile not found — complete your profile first',
      );

    const objectPath = `rate-cards/${this.storage.buildFilename(file.originalname)}`;
    await this.storage.uploadPrivate(objectPath, file.buffer, file.mimetype);

    await this.prisma.influencerProfile.update({
      where: { userId },
      data: { rateCardFileUrl: objectPath },
    });

    await this.storage.deletePrivate(profile.rateCardFileUrl);
    // Return a signed URL (the read shape) so the client can render it immediately.
    return { rateCardFileUrl: await this.storage.signPrivate(objectPath) };
  }

  async deleteRateCardFile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'INFLUENCER') throw new ForbiddenException();

    const profile = await this.prisma.influencerProfile.findUnique({
      where: { userId },
      select: { rateCardFileUrl: true },
    });

    await this.prisma.influencerProfile.updateMany({
      where: { userId },
      data: { rateCardFileUrl: null },
    });

    await this.storage.deletePrivate(profile?.rateCardFileUrl);
    return { message: 'Rate card removed' };
  }

  // ─── DELETE PROFILE (soft delete) ────────────────────────────────────────────
  async deleteProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundException('User not found');

    // Soft delete — set isDeleted flag instead of removing the row
    // This preserves campaign history, reviews, tracking results etc.
    // Storage objects (avatar, rate card) are intentionally NOT deleted here —
    // a soft-deleted account may be restored, and its files must survive.
    await this.prisma.user.update({
      where: { id: userId },
      data: { isDeleted: true },
    });

    return { message: 'Account deleted successfully' };
  }

  // ─── GET COMPLETENESS ─────────────────────────────────────────────────────────
  async getCompleteness(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: true,
        agencyProfile: true,
        influencerProfile: {
          include: { platformAccounts: true, rateCards: true },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const score = await this.calculateCompleteness(userId);
    return { profileCompleteness: score };
  }

  // ─── PRIVATE: CALCULATE COMPLETENESS ─────────────────────────────────────────
  private async calculateCompleteness(
    userId: string,
    tx?: any,
  ): Promise<number> {
    const client = tx ?? this.prisma;

    const user = await client.user.findUnique({
      where: { id: userId },
      include: {
        brandProfile: true,
        agencyProfile: true,
        influencerProfile: {
          include: { platformAccounts: true, rateCards: true },
        },
      },
    });

    if (!user) return 0;

    let filled = 0;
    let total = 0;

    // Shared fields
    const sharedFields = [user.name, user.email];
    total += sharedFields.length;
    filled += sharedFields.filter(Boolean).length;

    if (user.role === 'BRAND' || user.role === 'AGENCY') {
      const p = user.brandProfile ?? user.agencyProfile;
      const fields = [
        p?.companyName,
        p?.position,
        p?.telephone,
        p?.companyDetail,
        p?.websiteUrl,
        p?.socialLinks,
      ];
      total += fields.length;
      filled += fields.filter(Boolean).length;
    }

    if (user.role === 'INFLUENCER') {
      const p = user.influencerProfile;
      const fields = [p?.bio, p?.categories, p?.styleTags, p?.keywords];
      total += fields.length;
      filled += fields.filter(
        (v) => v && (Array.isArray(v) ? v.length > 0 : true),
      ).length;

      // Platform accounts and rate card count as single items
      total += 2;
      if (p?.platformAccounts?.length) filled += 1;
      if (p?.rateCards?.length) filled += 1;
    }

    return total > 0 ? Math.round((filled / total) * 100) : 0;
  }
}
