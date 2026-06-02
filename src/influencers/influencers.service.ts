import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InfluencersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any) {
    const {
      category,
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
    } = query;

    const where: any = {};

    if (category && category !== 'All') {
      where.categories = {
        array_contains: category.toLowerCase(),
      };
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
      where.OR = [
        { bio: { contains: keyword, mode: 'insensitive' } },
        { user: { name: { contains: keyword, mode: 'insensitive' } } },
        { 
          categories: {
            array_contains: keyword.toLowerCase()
          }
        }
      ];
    }

    const parsedQualityScore = parseFloat(minQualityScore);
    if (!isNaN(parsedQualityScore)) {
      where.qualityScore = { gte: parsedQualityScore };
    }

    const parsedPerformanceScore = parseFloat(minPerformanceScore);
    if (!isNaN(parsedPerformanceScore)) {
      where.performanceScore = { gte: parsedPerformanceScore };
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
