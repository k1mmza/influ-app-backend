import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { CATEGORY_TAGS, STYLE_TAGS } from './ai-analysis.service';
import { extractFirstJson } from '../common/extract-json';

/** Cheapest current-gen Gemini model — fits this lightweight JSON task. */
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

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
  stylePresent?: string;
  keyword?: string;
}

@Injectable()
export class SmartSearchService {
  private readonly logger = new Logger(SmartSearchService.name);
  private readonly MAX_CATEGORIES = 3;
  private readonly client: GoogleGenAI | null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    } else {
      this.logger.warn(
        'GEMINI_API_KEY not set — smart search will return empty filters',
      );
      this.client = null;
    }
  }

  async parseQuery(query: string): Promise<ParsedFilters> {
    if (!this.client) return {};

    // Gemini's JSON mode (responseMimeType) returns a raw object directly, so the
    // old Anthropic prefill-'{' + stop-sequence-'}' trick is no longer needed.
    const systemInstruction = `You convert a natural-language influencer-search query into a JSON filter object.
Return ONLY the raw JSON object — no markdown, no code fences, no prose.

Rules:
- The query may be in Thai, English, or any language, or a mix. Interpret its MEANING regardless of language. All enum values below and the "country" value MUST be output in English (e.g. a Thai travel query → categories:["Travel"], "ประเทศไทย" → country:"Thailand"). The ONE exception is "keyword": copy proper names (brands, products, creators) VERBATIM as the user wrote them — never translate or transliterate them.
- Output only fields the query clearly and explicitly states. If you are unsure about a field, OMIT it. Never guess, never fill in defaults, never infer a filter the user did not ask for. Fewer correct fields beat more speculative ones.
- Use ONLY the field names and allowed values listed below. Never invent a field name or a value outside the allowed set. If a requested value is not in an allowed set, omit that field.
- Enum values are case-sensitive: copy them EXACTLY as written.
- Return {} if nothing maps.

Fields:
- platforms: string[] — subset of exactly: ["tiktok","instagram","youtube","facebook","x","lemon8"]. Lowercase. Map "twitter"/"X"/"ทวิตเตอร์" → "x". If the user names any platform NOT in this list (e.g. LinkedIn, Snapchat, Pinterest, Threads, Twitch), OMIT it entirely — never include it and never substitute a similar one.
- categories: string[], max 3 — subset of exactly: ${CATEGORY_TAGS.join(', ')}. Always an array, even for one: ["Travel"].
- followerRange: one of exactly "Nano" | "Micro" | "Mid" | "Macro" | "Mega" (case-sensitive). ONLY when the user names a tier ("micro influencer", "macro creator"). Do NOT use it for numeric thresholds like "over 500k" — use minFollowers for those. Never both.
- minFollowers: integer — for "over X", "at least X", "more than X followers". Expand shorthand: "1M"/"1 million" → 1000000, "10k" → 10000.
- minAverageViews: integer.
- minEngagementRate: number — percentage as a plain number ("at least 3.5%" → 3.5).
- minGrowthRate: number — percentage as a plain number.
- minQualityScore: number 0-100.
- minPerformanceScore: number 0-100.
- maxRatePerPost: integer — max price per post in THB.
- minResponseRate: number 0-100.
- audienceGender: one of exactly "Male" | "Female" | "Mixed".
- audienceAgeGroup: one of exactly "18-24" | "25-34" | "35-44" | "45+" (case- and format-exact). "teen"/"teenage" → "18-24".
- country: string.
- stylePresent: one of exactly: ${STYLE_TAGS.join(', ')}.
- keyword: string — ONLY a specific brand, product, or creator name explicitly named. NEVER put leftover, unmatched, or arbitrary query text here. If the query is gibberish, a greeting, or has no recognizable filter criteria, return {} — do not salvage it into keyword.

Examples:
Query: "micro travel influencers on tiktok in thailand"
{"platforms":["tiktok"],"categories":["Travel"],"followerRange":"Micro","country":"Thailand"}

Query: "youtube gaming creators with over 1 million followers and 5% engagement"
{"platforms":["youtube"],"categories":["Gaming"],"minFollowers":1000000,"minEngagementRate":5}

Query: "female beauty creators aged 18-24 who do product reviews under 20000 baht per post"
{"categories":["Beauty"],"audienceGender":"Female","audienceAgeGroup":"18-24","stylePresent":"Review","maxRatePerPost":20000}

Query (Thai): "อินฟลูสายอาหารในไอจี มีผู้ติดตามมากกว่า 50000 คน"
{"platforms":["instagram"],"categories":["Food"],"minFollowers":50000}

Query: "influencers on linkedin"
{}

Query: "asdfgh hello random text 12345"
{}`;

    try {
      const response = await this.client.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Parse this search query into filters: "${query}"`,
        config: {
          systemInstruction,
          temperature: 0,
          maxOutputTokens: 256,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });

      const completion = extractFirstJson(response.text ?? '{}');
      const parsed = JSON.parse(completion || '{}');
      this.logger.log(`Smart search parsed: ${JSON.stringify(parsed)}`);
      return parsed;
    } catch (err) {
      this.logger.error(
        `Gemini parsing failed, returning empty filters (query="${query}")`,
        err,
      );
      return {};
    }
  }
}
