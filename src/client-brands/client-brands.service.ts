import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateManagedBrandDto } from './dto/create-managed-brand.dto';

const CLIENT_BRAND_SELECT = {
  id: true,
  brandName: true,
  brandEmail: true,
  brandWebsite: true,
  logoUrl: true,
  origin: true,
} as const;

@Injectable()
export class ClientBrandsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the ClientBrands the caller may create campaigns against.
   * - AGENCY: every brand it manages (agencyId === its profile id).
   * - BRAND: its single own ClientBrand (may be empty until first campaign).
   * Used to populate the client-brand picker on the campaign create form.
   *
   * `search`, when given, is a case-insensitive brandName filter ANDed *inside*
   * the owner scope — it narrows the caller's own brands, never widens across
   * agencies.
   */
  async getClientBrandsForUser(userId: string, search?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { agencyProfile: true, brandProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Owner scope first — this is the non-negotiable tenant boundary.
    let ownerWhere: Prisma.ClientBrandWhereInput;
    if (user.role === 'AGENCY') {
      if (!user.agencyProfile)
        throw new ForbiddenException('Agency profile required');
      ownerWhere = { agencyId: user.agencyProfile.id };
    } else if (user.role === 'BRAND') {
      if (!user.brandProfile)
        throw new ForbiddenException('Brand profile required');
      ownerWhere = { brandProfileId: user.brandProfile.id };
    } else {
      throw new ForbiddenException(
        'Only brand and agency users have client brands',
      );
    }

    // Search is layered on top of (AND) the owner scope, so it can only ever
    // narrow the caller's own brands — no cross-tenant leak.
    const term = search?.trim();
    const where: Prisma.ClientBrandWhereInput = term
      ? { ...ownerWhere, brandName: { contains: term, mode: 'insensitive' } }
      : ownerWhere;

    return this.prisma.clientBrand.findMany({
      where,
      select: CLIENT_BRAND_SELECT,
      orderBy: { joinedAt: 'asc' },
    });
  }

  /**
   * Agency-only: create a managed (unclaimed) brand inline — no linked account.
   * Guarded at the route by @Roles(AGENCY); re-checked here so the write path
   * can never create an agency-scoped row for a non-agency caller.
   */
  async createManagedBrand(userId: string, dto: CreateManagedBrandDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { agencyProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'AGENCY' || !user.agencyProfile) {
      throw new ForbiddenException('Only agency users can create managed brands');
    }

    return this.prisma.clientBrand.create({
      data: {
        agencyId: user.agencyProfile.id,
        brandProfileId: null,
        brandName: dto.brandName.trim(),
        brandEmail: dto.brandEmail?.trim() || null,
        logoUrl: dto.logoUrl?.trim() || null,
        origin: 'AGENCY_MANAGED',
        isRegistered: false,
        // TODO(claim-flow): when invite-to-claim lands, this row becomes claimable
        // by a real BrandProfile/User; nothing here needs to change to allow that.
      },
      select: CLIENT_BRAND_SELECT,
    });
  }
}
