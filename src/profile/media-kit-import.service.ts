import { Injectable, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import {
  AiAnalysisService,
  CATEGORY_TAGS,
  STYLE_TAGS,
} from '../influencers/ai-analysis.service';

/**
 * Self-reported fields the import is ALLOWED to propose. These mirror
 * UpdateInfluencerProfileDto exactly — nothing here is an objective metric.
 */
export interface MediaKitRateCard {
  pricePerPost?: number;
  pricePerVideo?: number;
  pricePerStory?: number;
  packagePrice?: number;
  packageDescription?: string;
}

export interface MediaKitProposed {
  bio?: string;
  categories?: string[];
  styleTags?: string[];
  keywords?: string[];
  hashtags?: string[];
  availabilityStatus?: string;
  rateCard?: MediaKitRateCard;
}

/**
 * Objective-metric numbers a media kit may CLAIM. Display-only — these are
 * NEVER mapped into any writable profile field. Discover/search metrics come
 * exclusively from the OAuth/adapter sync pipeline.
 */
export interface MediaKitClaimedMetrics {
  followers?: number;
  avgViews?: number;
  engagementRate?: number;
  growthRate?: number;
}

export interface MediaKitAnalysisResult {
  proposed: MediaKitProposed;
  claimedMetrics: MediaKitClaimedMetrics;
  warnings: string[];
  source: 'json' | 'text' | 'pdf' | 'image' | 'unknown';
}

type UploadedFileLike = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

/** Keys that must ONLY ever land in claimedMetrics, never in proposed. */
const METRIC_ALIASES: Record<keyof MediaKitClaimedMetrics, string[]> = {
  followers: [
    'followers',
    'follower_count',
    'followercount',
    'totalfollowers',
    'total_followers',
    'subscribers',
    'subscribercount',
    'subscriber_count',
    'audiencesize',
  ],
  avgViews: [
    'avgviews',
    'averageviews',
    'avg_views',
    'average_views',
    'views',
    'averageviewsperpost',
  ],
  engagementRate: [
    'engagementrate',
    'engagement_rate',
    'engagement',
    'er',
    'avgengagement',
  ],
  growthRate: ['growthrate', 'growth_rate', 'growth'],
};

@Injectable()
export class MediaKitImportService {
  private readonly logger = new Logger(MediaKitImportService.name);

  constructor(private readonly ai: AiAnalysisService) {}

  /**
   * Entry point. Routes by file type, extracts proposed values, and ALWAYS
   * returns a result — never throws, never writes anything. The caller (user)
   * must confirm before any of this reaches PATCH /profile.
   */
  async analyzeFile(
    file: UploadedFileLike | undefined,
  ): Promise<MediaKitAnalysisResult> {
    if (!file || !file.buffer?.length) {
      return this.empty('unknown', [
        'No file received. Download the template, fill it in, and upload it (text or PDF).',
      ]);
    }

    const name = (file.originalname || '').toLowerCase();
    const mime = file.mimetype || '';

    const isJson = mime.includes('json') || name.endsWith('.json');
    const isText = mime === 'text/plain' || name.endsWith('.txt');
    const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
    const isImage = mime.startsWith('image/');

    if (isJson) return this.analyzeJson(file.buffer);
    if (isText) return this.analyzeText(file.buffer);
    if (isPdf) return this.analyzePdf(file.buffer);
    if (isImage) {
      return this.empty('image', [
        'Image media kits are not supported yet — upload the filled-in text template or a text-based PDF.',
      ]);
    }
    return this.empty('unknown', [
      'Unsupported file type. Upload the filled-in text template (.txt) or a text-based PDF.',
    ]);
  }

  // ─── JSON path (deterministic, no AI) ──────────────────────────────────────
  private analyzeJson(buffer: Buffer): MediaKitAnalysisResult {
    let raw: unknown;
    try {
      raw = JSON.parse(buffer.toString('utf-8'));
    } catch {
      return this.empty('json', [
        "Couldn't parse that file as JSON. Check the file and try again.",
      ]);
    }
    // Tolerate a top-level { mediaKit: {...} } envelope.
    const obj = isRecord(raw) && isRecord(raw.mediaKit) ? raw.mediaKit : raw;
    if (!isRecord(obj)) {
      return this.empty('json', [
        'The JSON did not contain any fields to import.',
      ]);
    }
    const { proposed, claimedMetrics } = this.mapRaw(obj);
    const warnings: string[] = [];
    if (Object.keys(proposed).length === 0) {
      warnings.push('No recognizable profile fields were found in the file.');
    }
    return { proposed, claimedMetrics, warnings, source: 'json' };
  }

  // ─── Text-template path (deterministic, no AI) ─────────────────────────────
  // The human-friendly "Label: value" template downloaded in the app. No JSON
  // knowledge required. A plain .json uploaded as text/plain is handled too.
  private analyzeText(buffer: Buffer): MediaKitAnalysisResult {
    const content = buffer.toString('utf-8');
    const trimmed = content.trim();

    // A JSON export may arrive with a text/plain mime — parse it transparently.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const raw: unknown = JSON.parse(trimmed);
        const obj = isRecord(raw) && isRecord(raw.mediaKit) ? raw.mediaKit : raw;
        if (isRecord(obj)) {
          const { proposed, claimedMetrics } = this.mapRaw(obj);
          return {
            proposed,
            claimedMetrics,
            warnings: Object.keys(proposed).length
              ? []
              : ['No recognizable profile fields were found in the file.'],
            source: 'json',
          };
        }
      } catch {
        // Not valid JSON — fall through to the labelled-line parser.
      }
    }

    const record = parseLabeledText(content);
    const { proposed, claimedMetrics } = this.mapRaw(record);
    const warnings: string[] = [];
    if (Object.keys(proposed).length === 0) {
      warnings.push(
        'No filled-in fields were found. Open the template, type your details after each colon, and upload it again.',
      );
    }
    return { proposed, claimedMetrics, warnings, source: 'text' };
  }

  // ─── PDF path (text extraction → Haiku) ────────────────────────────────────
  private async analyzePdf(buffer: Buffer): Promise<MediaKitAnalysisResult> {
    let text = '';
    try {
      // Use the newer bundled pdfjs (v2.0.550) — the default v1.10.100 is from
      // 2018 and throws on many modern PDFs (e.g. design-tool exports with
      // compressed xref streams / subsetted fonts).
      const data = await pdfParse(buffer, { version: 'v2.0.550' });
      text = (data.text || '').trim();
    } catch (err: any) {
      this.logger.error(`PDF text extraction failed: ${err.message}`);
      return this.empty('pdf', [
        "Couldn't read this PDF — some media-kit PDFs (especially design-tool exports) aren't text-readable. Use the “Download Template” button, fill in the text file, and upload that instead.",
      ]);
    }

    if (text.length < 20) {
      // Image-only / scanned PDF — we do not OCR or run vision here.
      return this.empty('pdf', [
        'This PDF has no extractable text (it looks scanned or image-only). Use the “Download Template” button and upload the filled-in text file instead.',
      ]);
    }

    const raw = await this.ai.analyzeMediaKit(text);
    if (!raw) {
      return this.empty('pdf', [
        'AI extraction was unavailable or failed. Nothing was changed — you can edit your profile manually.',
      ]);
    }

    const { proposed, claimedMetrics } = this.mapRaw(raw);
    const warnings: string[] = [
      'PDF extraction is approximate — please review every field before saving.',
    ];
    if (Object.keys(proposed).length === 0) {
      warnings.push('No profile fields could be extracted from this PDF.');
    }
    return { proposed, claimedMetrics, warnings, source: 'pdf' };
  }

  /**
   * Shared mapper used by BOTH the JSON and AI paths. This is the single
   * firewall: self-reported fields go to `proposed`; anything metric-like is
   * diverted to `claimedMetrics` and can never reach a writable field.
   */
  mapRaw(raw: Record<string, unknown>): {
    proposed: MediaKitProposed;
    claimedMetrics: MediaKitClaimedMetrics;
  } {
    const lower = lowerKeyed(raw);
    const proposed: MediaKitProposed = {};

    // bio
    const bio = firstString(lower, ['bio', 'description', 'about', 'summary']);
    if (bio) proposed.bio = bio.substring(0, 500);

    // categories / styleTags — constrained to the predefined VALID_TAGS list
    const categories = normalizeTags(
      pickArrayish(lower, [
        'categories',
        'category',
        'niche',
        'niches',
        'verticals',
      ]),
      CATEGORY_TAGS,
    );
    if (categories.length) proposed.categories = categories;

    const styleTags = normalizeTags(
      pickArrayish(lower, ['styletags', 'style_tags', 'tags', 'contentstyle']),
      STYLE_TAGS,
    );
    if (styleTags.length) proposed.styleTags = styleTags;

    // keywords (free-form)
    const keywords = stringArray(pickArrayish(lower, ['keywords'])).slice(
      0,
      20,
    );
    if (keywords.length) proposed.keywords = keywords;

    // hashtags (free-form, normalize leading #)
    const hashtags = stringArray(pickArrayish(lower, ['hashtags']))
      .map((h) => (h.startsWith('#') ? h : `#${h}`))
      .slice(0, 30);
    if (hashtags.length) proposed.hashtags = hashtags;

    // availabilityStatus
    const avail = firstString(lower, ['availabilitystatus', 'availability']);
    if (avail) proposed.availabilityStatus = avail.substring(0, 60);

    // rateCard — from a nested rateCard/pricing/rates object or flat keys
    const rateCard = this.extractRateCard(lower);
    if (rateCard && Object.keys(rateCard).length) proposed.rateCard = rateCard;

    // claimedMetrics — display-only, separate channel
    const claimedMetrics: MediaKitClaimedMetrics = {};
    for (const key of Object.keys(METRIC_ALIASES) as Array<
      keyof MediaKitClaimedMetrics
    >) {
      // 1) explicit nested claimedMetrics object from the AI path
      const fromNested = isRecord(lower.claimedmetrics)
        ? toNumber((lowerKeyed(lower.claimedmetrics) as any)[key.toLowerCase()])
        : undefined;
      // 2) aliases scattered at the top level (JSON path)
      const fromAlias = firstNumber(lower, METRIC_ALIASES[key]);
      const val = fromNested ?? fromAlias;
      if (val !== undefined) claimedMetrics[key] = val;
    }

    return { proposed, claimedMetrics };
  }

  private extractRateCard(
    lower: Record<string, unknown>,
  ): MediaKitRateCard | null {
    // A nested object may carry the prices: rateCard / pricing / rates.
    const nested =
      [lower.ratecard, lower.pricing, lower.rates].find((v) => isRecord(v)) ??
      null;
    const src = nested ? lowerKeyed(nested) : lower;

    const out: MediaKitRateCard = {};
    const post = firstNumber(src, [
      'priceperpost',
      'price_per_post',
      'post',
      'postprice',
    ]);
    if (post !== undefined) out.pricePerPost = post;

    const video = firstNumber(src, [
      'pricepervideo',
      'price_per_video',
      'video',
      'videoprice',
    ]);
    if (video !== undefined) out.pricePerVideo = video;

    const story = firstNumber(src, [
      'priceperstory',
      'price_per_story',
      'story',
      'storyprice',
    ]);
    if (story !== undefined) out.pricePerStory = story;

    const bundle = firstNumber(src, [
      'packageprice',
      'package_price',
      'bundle',
      'packageprice',
    ]);
    if (bundle !== undefined) out.packagePrice = bundle;

    const desc = firstString(src, [
      'packagedescription',
      'package_description',
      'packagedesc',
    ]);
    if (desc) out.packageDescription = desc.substring(0, 500);

    return Object.keys(out).length ? out : null;
  }

  private empty(
    source: MediaKitAnalysisResult['source'],
    warnings: string[],
  ): MediaKitAnalysisResult {
    return { proposed: {}, claimedMetrics: {}, warnings, source };
  }
}

// ─── pure helpers ────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse the human-friendly text template: one "Label: value" per line, with
 * `#` comment lines and blanks ignored. Labels are normalized to alias keys
 * (lower-cased, non-alphanumerics stripped) so mapRaw's existing aliases match —
 * e.g. "Price per post" → "priceperpost", "Average views" → "averageviews".
 * Only the first colon splits, so values may themselves contain colons (URLs).
 */
function parseLabeledText(content: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed
      .slice(0, idx)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const value = trimmed.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

/** Lower-case all top-level keys so alias lookups are case-insensitive. */
function lowerKeyed(v: unknown): Record<string, unknown> {
  if (!isRecord(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k.toLowerCase()] = val;
  return out;
}

function firstString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    // strip thousands separators, spaces, currency, and a trailing % (e.g. "4.5%")
    const cleaned = v.replace(/[,\s%฿$€£]/g, '');
    // support shorthand like "12k" / "1.2m"
    const m = cleaned.match(/^([\d.]+)\s*([kmb])?$/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (!Number.isFinite(n)) return undefined;
      const unit = (m[2] || '').toLowerCase();
      const mult =
        unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : unit === 'b' ? 1e9 : 1;
      return n * mult;
    }
  }
  return undefined;
}

function firstNumber(
  obj: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const k of keys) {
    if (k in obj) {
      const n = toNumber(obj[k]);
      if (n !== undefined) return n;
    }
  }
  return undefined;
}

/** Returns the first value among keys that is an array or comma string. */
function pickArrayish(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] != null) return obj[k];
  }
  return undefined;
}

function stringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim());
  }
  if (typeof v === 'string') {
    return v
      .split(/[,\n]/g)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

/** Constrain free tags to a predefined allowed list (case-insensitive). */
function normalizeTags(v: unknown, allowed: string[]): string[] {
  const canon = new Map(allowed.map((t) => [t.toLowerCase(), t]));
  const out: string[] = [];
  for (const raw of stringArray(v)) {
    const hit = canon.get(raw.toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out.slice(0, 6);
}
