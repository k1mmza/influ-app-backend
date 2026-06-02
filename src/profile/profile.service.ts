import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
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

    const profile =
      user.brandProfile ?? user.agencyProfile ?? user.influencerProfile ?? null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      profileCompleteness: user.profileCompleteness,
      profile,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundException('User not found');

    return this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { name: dto.name },
        });
      }

      const { name: _name, bio, categories, availabilityStatus, ...companyFields } = dto;

      if (user.role === 'BRAND') {
        await tx.brandProfile.upsert({
          where: { userId },
          create: { userId, ...this.brandFields(companyFields) },
          update: this.brandFields(companyFields),
        });
      } else if (user.role === 'AGENCY') {
        await tx.agencyProfile.upsert({
          where: { userId },
          create: { userId, ...this.brandFields(companyFields) },
          update: this.brandFields(companyFields),
        });
      } else if (user.role === 'INFLUENCER') {
        await tx.influencerProfile.upsert({
          where: { userId },
          create: {
            userId,
            bio,
            categories: categories ?? [],
            availabilityStatus,
          },
          update: {
            ...(bio !== undefined && { bio }),
            ...(categories !== undefined && { categories }),
            ...(availabilityStatus !== undefined && { availabilityStatus }),
          },
        });
      }

      return this.getProfile(userId);
    });
  }

  private brandFields(dto: Partial<UpdateProfileDto>) {
    return {
      ...(dto.companyName !== undefined && { companyName: dto.companyName }),
      ...(dto.position !== undefined && { position: dto.position }),
      ...(dto.telephone !== undefined && { telephone: dto.telephone }),
      ...(dto.companyDetail !== undefined && { companyDetail: dto.companyDetail }),
      ...(dto.websiteUrl !== undefined && { websiteUrl: dto.websiteUrl }),
      ...(dto.socialLinks !== undefined && { socialLinks: dto.socialLinks }),
    };
  }
}
