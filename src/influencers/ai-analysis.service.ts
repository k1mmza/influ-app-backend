import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { YoutubeTranscript } from 'youtube-transcript';
import { extractFirstJson } from '../common/extract-json';

/** Cheapest current-gen Gemini model — fits these lightweight JSON tasks. */
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

export interface AiChannelAnalysis {
  bio: string;
  tags: string[];
  category: string;
  audienceGender: string | null;
  audienceAgeGroup: string | null;
  audienceCountry: string | null;
}

/** Topic/niche categories — the "what the creator is about". A profile's
 *  `category` and `categories[]` are chosen only from this list. */
export const CATEGORY_TAGS = [
  'Beauty',
  'Fashion',
  'Fitness',
  'Food',
  'Gaming',
  'Travel',
  'Tech',
  'Lifestyle',
  'Education',
  'Entertainment',
  'Business',
  'Music',
  'Sports',
  'Comedy',
  'DIY',
  'Cooking',
  'Health',
];

/** Content-format styles — the "how the creator presents". `styleTags[]`
 *  (a.k.a. stylePresent) are chosen only from this list. Kept in sync with the
 *  frontend's stylePresentOptions. */
export const STYLE_TAGS = [
  'Short Story',
  'Storytelling',
  'Experiment',
  'Tutorial',
  'Review',
  'Vlog',
];

/** Union of both lists — for callers that only need "is this a known tag". */
export const VALID_TAGS = [...CATEGORY_TAGS, ...STYLE_TAGS];

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);
  private readonly client: GoogleGenAI | null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    } else {
      this.logger.warn(
        'GEMINI_API_KEY not set — AI analysis will be skipped',
      );
      this.client = null;
    }
  }

  async analyzeYouTubeChannel(
    channelName: string,
    channelBio: string | null,
    topVideoIds: string[],
    videoTitles: string[],
  ): Promise<AiChannelAnalysis | null> {
    if (!this.client) return null;

    const transcriptSnippets = await this.fetchTranscriptSnippets(
      topVideoIds.slice(0, 3),
    );

    const parts: string[] = [`Channel Name: ${channelName}`];
    if (channelBio) {
      parts.push(`Channel Description: ${channelBio.substring(0, 500)}`);
    }
    if (videoTitles.length > 0) {
      const list = videoTitles
        .slice(0, 10)
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n');
      parts.push(`Recent Video Titles:\n${list}`);
    }
    if (transcriptSnippets.length > 0) {
      const excerpts = transcriptSnippets
        .map((t, i) => `--- Video ${i + 1} ---\n${t}`)
        .join('\n\n');
      parts.push(`Transcript Excerpts:\n${excerpts}`);
    }

    const context = parts.join('\n\n');

    const prompt = `Analyze this YouTube channel and return a JSON object with exactly six fields:
- "bio": A compelling 1-2 sentence creator description written in third person (max 150 characters)
- "tags": An array of 2-4 content STYLE tags chosen ONLY from this list: ${STYLE_TAGS.join(', ')}
- "category": The single best-fit topic CATEGORY chosen ONLY from this list: ${CATEGORY_TAGS.join(', ')}
- "audienceGender": Estimated dominant audience gender — must be exactly one of: "Female", "Male", "Mixed"
- "audienceAgeGroup": Estimated primary audience age group — must be exactly one of: "18-24", "25-34", "35-44", "45+"
- "audienceCountry": Estimated top audience country as a full English country name (e.g. "United States"), or null if unclear

Base demographic estimates on the content style, language, topics, and cultural references in the channel.

${context}

Respond with valid JSON only. No markdown fences, no explanation.`;

    try {
      const response = await this.client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });

      const raw = response.text ?? '';
      // JSON mode can append stray trailing chars — slice out the first complete object
      const parsed = JSON.parse(extractFirstJson(raw)) as {
        bio?: string;
        tags?: unknown;
        category?: string;
        audienceGender?: string;
        audienceAgeGroup?: string;
        audienceCountry?: string | null;
      };

      const rawTags = Array.isArray(parsed.tags)
        ? (parsed.tags as string[])
        : [];
      const tags = rawTags.filter((t) => STYLE_TAGS.includes(t)).slice(0, 4);
      const category = CATEGORY_TAGS.includes(parsed.category ?? '')
        ? parsed.category!
        : 'Lifestyle';

      const VALID_GENDERS = ['Female', 'Male', 'Mixed'];
      const VALID_AGE_GROUPS = ['18-24', '25-34', '35-44', '45+'];

      return {
        bio: (parsed.bio ?? '').substring(0, 200),
        tags,
        category,
        audienceGender: VALID_GENDERS.includes(parsed.audienceGender ?? '')
          ? parsed.audienceGender!
          : null,
        audienceAgeGroup: VALID_AGE_GROUPS.includes(
          parsed.audienceAgeGroup ?? '',
        )
          ? parsed.audienceAgeGroup!
          : null,
        audienceCountry: parsed.audienceCountry ?? null,
      };
    } catch (err: any) {
      this.logger.error(`AI channel analysis failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Generic profile analysis for TikTok / Instagram — no transcripts,
   * uses bio + recent post captions instead.
   */
  async analyzeProfile(
    platform: string,
    displayName: string,
    bio: string | null,
    postCaptions: string[],
  ): Promise<AiChannelAnalysis | null> {
    if (!this.client) return null;

    const parts: string[] = [
      `Platform: ${platform}`,
      `Creator Name: ${displayName}`,
    ];
    if (bio) parts.push(`Bio: ${bio.substring(0, 300)}`);
    if (postCaptions.length > 0) {
      const list = postCaptions
        .slice(0, 10)
        .map((c, i) => `${i + 1}. ${c.substring(0, 150)}`)
        .join('\n');
      parts.push(`Recent Post Captions:\n${list}`);
    }
    const context = parts.join('\n\n');

    const prompt = `Analyze this ${platform} creator profile and return a JSON object with exactly six fields:
- "bio": A compelling 1-2 sentence creator description written in third person (max 150 characters)
- "tags": An array of 2-4 content STYLE tags chosen ONLY from this list: ${STYLE_TAGS.join(', ')}
- "category": The single best-fit topic CATEGORY chosen ONLY from this list: ${CATEGORY_TAGS.join(', ')}
- "audienceGender": Estimated dominant audience gender — must be exactly one of: "Female", "Male", "Mixed"
- "audienceAgeGroup": Estimated primary audience age group — must be exactly one of: "18-24", "25-34", "35-44", "45+"
- "audienceCountry": Estimated top audience country as a full English country name (e.g. "United States"), or null if unclear

Base demographic estimates on the content style, language, topics, and cultural references.

${context}

Respond with valid JSON only. No markdown fences, no explanation.`;

    try {
      const response = await this.client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });

      const raw = response.text ?? '';
      // JSON mode can append stray trailing chars — slice out the first complete object
      const parsed = JSON.parse(extractFirstJson(raw)) as {
        bio?: string;
        tags?: unknown;
        category?: string;
        audienceGender?: string;
        audienceAgeGroup?: string;
        audienceCountry?: string | null;
      };

      const rawTags = Array.isArray(parsed.tags)
        ? (parsed.tags as string[])
        : [];
      const tags = rawTags.filter((t) => STYLE_TAGS.includes(t)).slice(0, 4);
      const category = CATEGORY_TAGS.includes(parsed.category ?? '')
        ? parsed.category!
        : 'Lifestyle';
      const VALID_GENDERS = ['Female', 'Male', 'Mixed'];
      const VALID_AGE_GROUPS = ['18-24', '25-34', '35-44', '45+'];

      return {
        bio: (parsed.bio ?? '').substring(0, 200),
        tags,
        category,
        audienceGender: VALID_GENDERS.includes(parsed.audienceGender ?? '')
          ? parsed.audienceGender!
          : null,
        audienceAgeGroup: VALID_AGE_GROUPS.includes(
          parsed.audienceAgeGroup ?? '',
        )
          ? parsed.audienceAgeGroup!
          : null,
        audienceCountry: parsed.audienceCountry ?? null,
      };
    } catch (err: any) {
      this.logger.error(
        `AI profile analysis failed for ${platform}/${displayName}: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Media-kit text extraction (PDF path). Sends extracted document text to Haiku
   * and asks for ONLY self-reported profile fields + a separate claimedMetrics
   * bucket. Returns the raw parsed JSON object (mapping/validation is enforced
   * downstream by MediaKitImportService) or null on any failure — never throws.
   *
   * NOTE: this proposes values only; nothing here writes to the profile.
   */
  async analyzeMediaKit(text: string): Promise<Record<string, unknown> | null> {
    if (!this.client) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const prompt = `You are extracting fields from an influencer's media kit document. Return ONLY a JSON object with this EXACT shape, no prose, no markdown fences:
{
  "bio": string | null,                    // short creator description, max 300 chars
  "categories": string[],                  // ONLY from: ${CATEGORY_TAGS.join(', ')}
  "styleTags": string[],                   // ONLY from: ${STYLE_TAGS.join(', ')}
  "keywords": string[],                    // free-form descriptive keywords
  "hashtags": string[],                    // hashtags, with or without leading #
  "availabilityStatus": string | null,     // e.g. "Available", "Booked until July"
  "rateCard": {                            // prices in plain numbers, omit unknown ones
    "pricePerPost": number | null,
    "pricePerVideo": number | null,
    "pricePerStory": number | null,
    "packagePrice": number | null,
    "packageDescription": string | null
  },
  "claimedMetrics": {                      // numbers the kit CLAIMS — never verified
    "followers": number | null,
    "avgViews": number | null,
    "engagementRate": number | null,
    "growthRate": number | null
  }
}
Rules:
- categories and styleTags MUST be chosen only from the allowed list; drop anything not on it.
- Put follower counts, view counts, engagement/growth rates ONLY in claimedMetrics, NEVER in any other field.
- If a value is not present in the document, use null (or an empty array). Do not invent values.

Media kit text:
"""
${trimmed.substring(0, 12000)}
"""

Respond with valid JSON only.`;

    try {
      const response = await this.client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });
      const raw = response.text ?? '';
      const parsed = this.parseJsonResponse(raw);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null;
    } catch (err: any) {
      this.logger.error(`AI media-kit analysis failed: ${err.message}`);
      return null;
    }
  }

  /** Extract the first complete JSON object and parse. Returns null on malformed JSON. */
  private parseJsonResponse(raw: string): unknown {
    try {
      return JSON.parse(extractFirstJson(raw));
    } catch {
      return null;
    }
  }

  private async fetchTranscriptSnippets(videoIds: string[]): Promise<string[]> {
    const snippets: string[] = [];
    for (const id of videoIds) {
      try {
        const entries = await YoutubeTranscript.fetchTranscript(id, {
          lang: 'en',
        });
        const text = entries
          .map((e) =>
            e.text
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, '&')
              .replace(/&quot;/g, '"')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>'),
          )
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 1200);
        if (text) snippets.push(text);
      } catch {
        // Transcript disabled or unavailable for this video — skip silently
      }
    }
    return snippets;
  }
}
