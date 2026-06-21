import { Injectable, Logger } from '@nestjs/common';

export interface ParsedFilters {
  platforms?: string[];
  categories?: string[];
  followerRange?: string;
  minFollowers?: number;
  minAverageViews?: number;
  minEngagementRate?: number;
  minGrowthRate?: number;
  minQualityScore?: number;
  minPerformanceScore?: number;
  maxRatePerPost?: number;
  minResponseRate?: number;
  audienceGender?: string;
  audienceAgeGroup?: string;
  country?: string;
  city?: string;
  stylePresent?: string;
  campaignIntents?: string[];
  keyword?: string;
}

@Injectable()
export class SmartSearchService {
  private readonly logger = new Logger(SmartSearchService.name);
  private readonly MAX_CATEGORIES = 3;

  async parseQuery(query: string): Promise<ParsedFilters> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 256,
          system: `You are a filter parser for an influencer discovery platform.
Extract search filters from a natural language query and return ONLY a valid JSON object.
Do not include any explanation, markdown, or extra text — just raw JSON.

Available fields:
- platforms: string[] (TikTok, Instagram, YouTube, Facebook, X, Lemon8, LinkedIn)
- categories: string[] — return an array of matched categories, max 3. Pick from: Travel, Food, Beauty, Lifestyle, Fashion, Tech, Gaming, Fitness, Entertainment. Always return as array even for one category e.g. ["Travel"]
- followerRange: string (Nano, Micro, Mid, Macro, Mega) — only use when user explicitly mentions a tier name like "micro influencer" or "macro influencer". Do NOT use for "over X followers" or "at least X followers" queries
- minFollowers: number — use for "over X", "at least X", "more than X followers" queries instead of followerRange
- minAverageViews: number
- minEngagementRate: number (percentage e.g. 3.5)
- minGrowthRate: number (percentage)
- minQualityScore: number (0-100)
- minPerformanceScore: number (0-100)
- maxRatePerPost: number (THB)
- minResponseRate: number (0-100)
- audienceGender: string (Male, Female, Mixed)
- audienceAgeGroup: string (18-24, 25-34, 35-44, 45+) — "teen" or "teenage" maps to "18-24"
- country: string
- city: string
- stylePresent: string (Storytelling, Review, Tutorial, Vlog, Experiment)
- campaignIntents: string[] (Awareness, Engagement, Conversion, UGC)
- keyword: string — ONLY use for specific brand names, product names, or creator names explicitly mentioned. NEVER put leftover or unmatched query text here.

Only include fields clearly mentioned or strongly implied. Return {} if nothing can be extracted.`,
          messages: [
            {
              role: 'user',
              content: `Parse this search query into filters: "${query}"`,
            },
          ],
        }),
      });

      const data = await response.json();
      const text = data.content?.[0]?.text ?? '{}';
      const clean = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsed = JSON.parse(clean);
      this.logger.log(`Smart search parsed: ${JSON.stringify(parsed)}`);
      return parsed;
    } catch (err) {
      this.logger.error('Claude parsing failed, returning empty filters', err);
      return {};
    }
  }
}
