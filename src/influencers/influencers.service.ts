import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InfluencersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any) {
    const {
      categories: categoriesParam,
      platform,
      followerRange,
      minAverageViews,
      minEngagementRate,
      minGrowthRate,
      keyword,
      audienceGender,
      audienceAgeGroup,
      minQualityScore,
      minPerformanceScore,
      maxRatePerPost,
      minRatePerPost,
      minFollowers,
      minResponseRate,
      stylePresent,
      availabilityStatus,
    } = query;

    const where: any = {};
    const andConditions: any[] = [];

    if (categoriesParam) {
      const categoryList = (categoriesParam as string)
        .split(',')
        .map((c: string) => c.trim().toLowerCase())
        .filter(Boolean);
      if (categoryList.length === 1) {
        where.categories = { array_contains: categoryList[0] };
      } else if (categoryList.length > 1) {
        andConditions.push({
          OR: categoryList.map((cat: string) => ({ categories: { array_contains: cat } })),
        });
      }
    }

    if (platform && platform !== 'All') {
      where.platformAccounts = {
        some: {
          platform: platform.toLowerCase(),
        },
      };
    }

    if (followerRange && followerRange !== 'All') {
      const ranges: any = {
        Nano: { min: 1000, max: 10000 },
        Micro: { min: 10000, max: 100000 },
        Mid: { min: 100000, max: 500000 },
        Macro: { min: 500000, max: 1000000 },
        Mega: { min: 1000000 },
      };
      const range = ranges[followerRange];
      if (range) {
        where.platformAccounts = {
          ...where.platformAccounts,
          some: {
            ...(where.platformAccounts?.some || {}),
            followers: {
              gte: range.min,
              ...(range.max ? { lte: range.max } : {}),
            },
          },
        };
      }
    }

    const parsedEngagementRate = parseFloat(minEngagementRate);
    if (!isNaN(parsedEngagementRate)) {
      where.platformAccounts = {
        ...where.platformAccounts,
        some: {
          ...(where.platformAccounts?.some || {}),
          engagementRate: { gte: parsedEngagementRate },
        },
      };
    }

    if (keyword) {
      andConditions.push({
        OR: [
          { bio: { contains: keyword, mode: 'insensitive' } },
          { user: { name: { contains: keyword, mode: 'insensitive' } } },
          { categories: { array_contains: keyword.toLowerCase() } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const parsedQualityScore = parseFloat(minQualityScore);
    if (!isNaN(parsedQualityScore)) {
      where.qualityScore = { gte: parsedQualityScore };
    }

    const parsedPerformanceScore = parseFloat(minPerformanceScore);
    if (!isNaN(parsedPerformanceScore)) {
      where.performanceScore = { gte: parsedPerformanceScore };
    }

    const parsedGrowthRate = parseFloat(minGrowthRate);
    if (!isNaN(parsedGrowthRate) && parsedGrowthRate > 0) {
      where.growthRate = { gte: parsedGrowthRate };
    }

    const parsedResponseRate = parseFloat(minResponseRate);
    if (!isNaN(parsedResponseRate) && parsedResponseRate > 0) {
      where.responseRate = { gte: parsedResponseRate };
    }

    const parsedAvgViews = parseInt(minAverageViews, 10);
    if (!isNaN(parsedAvgViews) && parsedAvgViews > 0) {
      where.platformAccounts = {
        ...where.platformAccounts,
        some: {
          ...(where.platformAccounts?.some || {}),
          avgViews: { gte: parsedAvgViews },
        },
      };
    }

    const parsedMinRate = parseFloat(minRatePerPost);
    const parsedMaxRate = parseFloat(maxRatePerPost);
    const hasMinRate = !isNaN(parsedMinRate) && parsedMinRate > 0;
    const hasMaxRate = !isNaN(parsedMaxRate) && parsedMaxRate > 0;
    if (hasMinRate || hasMaxRate) {
      const priceCondition: any = {};
      if (hasMinRate) priceCondition.gte = parsedMinRate;
      if (hasMaxRate) priceCondition.lte = parsedMaxRate;
      where.rateCards = { some: { pricePerPost: priceCondition } };
    }

    const parsedMinFollowers = parseInt(minFollowers, 10);
    if (!isNaN(parsedMinFollowers) && parsedMinFollowers > 0) {
      where.platformAccounts = {
        ...where.platformAccounts,
        some: {
          ...(where.platformAccounts?.some || {}),
          followers: {
            ...(where.platformAccounts?.some?.followers || {}),
            gte: parsedMinFollowers,
          },
        },
      };
    }

    if (stylePresent && stylePresent !== 'All') {
      where.styleTags = { array_contains: stylePresent.toLowerCase() };
    }

    if (availabilityStatus && availabilityStatus !== 'All') {
      where.availabilityStatus = availabilityStatus;
    }

    const influencers = await this.prisma.influencerProfile.findMany({
      where,
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        platformAccounts: true,
      },
    });

    return influencers.map((inf) => this.formatInfluencer(inf));
  }

  private formatInfluencer(inf: any) {
    // Format to match frontend Influencer type
    const mainAccount = inf.platformAccounts.reduce((prev, current) => 
      (prev.followers > current.followers) ? prev : current, inf.platformAccounts[0] || {});

    return {
      id: inf.id,
      name: inf.user?.name || 'Unknown',
      platforms: inf.platformAccounts.map((p) => p.platform),
      followers: mainAccount.followers || 0,
      followersByPlatform: inf.platformAccounts.reduce((acc, p) => ({ ...acc, [p.platform]: p.followers }), {}),
      avgViewsByPlatform: inf.platformAccounts.reduce((acc, p) => ({ ...acc, [p.platform]: p.avgViews }), {}),
      engagementRate: mainAccount.engagementRate || 0,
      category: Array.isArray(inf.categories) ? inf.categories[0] : (inf.categories || 'Lifestyle'),
      performanceScore: inf.performanceScore || 85,
      ratePerPost: 0, // Need to fetch from RateCard if exists
      stylePresent: Array.isArray(inf.styleTags) ? inf.styleTags : [],
      meta: {
        country: 'Thailand', // Placeholder as not in schema directly
        city: 'Bangkok',
        audienceCountryPercent: 70,
        averageViews: mainAccount.avgViews || 0,
        growthRate: inf.growthRate || 0,
        qualityScore: inf.qualityScore || 80,
        responseRate: inf.responseRate || 90,
      }
    };
  }

  async findOne(id: string) {
    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { id },
      include: {
        user: true,
        platformAccounts: true,
        rateCards: true,
      },
    });
    return influencer ? this.formatInfluencer(influencer) : null;
  }
}
