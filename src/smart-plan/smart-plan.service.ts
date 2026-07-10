import {
  Injectable,
  Logger,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { CreateCampaignDto } from '../campaigns/dto/create-campaign.dto';
import { GenerateBriefDto } from './dto/generate-brief.dto';
import { SaveBriefDto } from './dto/save-brief.dto';
import {
  CreateFromPlanDto,
  PlanCampaignFields,
} from './dto/create-from-plan.dto';

export interface GeneratedBrief {
  strategy: string;
  concept: string;
  briefBody: string;
}

export interface Provenance {
  userProvided: string[];
  aiSuggested: string[];
}

export interface GeneratePlanResult extends GeneratedBrief {
  campaignFields: PlanCampaignFields;
  provenance: Provenance;
}

@Injectable()
export class SmartPlanService {
  private readonly logger = new Logger(SmartPlanService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignsService: CampaignsService,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — Smart Plan generation unavailable',
      );
      this.client = null;
    }
  }

  async generate(dto: GenerateBriefDto): Promise<GeneratePlanResult> {
    if (!this.client) {
      throw new ServiceUnavailableException('AI service is not configured');
    }

    const contextBlock = dto.rawPrompt
      ? `User's campaign description:\n"${dto.rawPrompt}"`
      : this.buildStructuredContext(dto);

    const prompt = `You are an expert influencer marketing strategist. Generate a complete campaign plan.

${contextBlock}

Return ONLY a valid JSON object — no markdown fences, no extra keys — with EXACTLY these fields:

{
  "strategy": "Campaign strategy (3-5 concise paragraphs: audience targeting, channel mix, phasing, how each KPI is hit)",
  "concept": "Creative concept (2-3 paragraphs: core idea, content formats, messaging angle, why it resonates)",
  "briefBody": "Creator brief ready to hand to influencers (product overview, key talking points, CTA, content guidelines, dos and don'ts)",
  "campaignFields": {
    "name": "Short campaign name — THIS FIELD IS MANDATORY, never empty",
    "objective": "One of: Awareness, Engagement, Conversion, UGC / content production",
    "budget": <number or null>,
    "visibility": "PUBLIC or PRIVATE",
    "paymentType": "e.g. Per post, Package, Affiliate",
    "keyMessage": "The core message creators should convey",
    "doAndDont": "Dos and don'ts for creators",
    "deliverables": "Posts, formats, volume, usage rights",
    "applyDeadline": null,
    "submissionDate": null,
    "reviewDate": null,
    "paymentDate": null,
    "requirements": {
      "minFollowers": <integer or null>,
      "minEngagementRate": <number or null>,
      "minAvgViews": <integer or null>,
      "platforms": ["TikTok","Instagram","YouTube"] or null,
      "locations": ["country/city"] or null,
      "categories": ["niche"] or null,
      "contentType": "e.g. Video, Reel, Story, Post"
    }
  }
}

CRITICAL RULES:
- "name" must ALWAYS be a non-empty string.
- The four date fields (applyDeadline, submissionDate, reviewDate, paymentDate) MUST be null. Do NOT invent dates from vague timelines — the user fills these in later.
- Use null for any value you cannot confidently infer. Do not fabricate.`;

    try {
      const message = await this.client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 3000, // raised from 1500 to fit the larger campaignFields JSON without truncation
        messages: [{ role: 'user', content: prompt }],
      });

      const raw =
        message.content[0].type === 'text'
          ? message.content[0].text.trim()
          : '{}';
      const json = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const parsed = JSON.parse(json) as Partial<GeneratePlanResult>;

      const rawFields = parsed.campaignFields ?? {};
      // name is mandatory — fall back so a later create never fails on a null name
      if (!rawFields.name || !String(rawFields.name).trim()) {
        rawFields.name = 'Untitled campaign';
      }
      // Force the four dates to null regardless of what the model returned
      rawFields.applyDeadline = null;
      rawFields.submissionDate = null;
      rawFields.reviewDate = null;
      rawFields.paymentDate = null;

      const campaignFields = this.stripNulls(rawFields);
      const provenance = this.buildProvenance(dto, campaignFields);

      return {
        strategy: parsed.strategy ?? '',
        concept: parsed.concept ?? '',
        briefBody: parsed.briefBody ?? '',
        campaignFields,
        provenance,
      };
    } catch (err: any) {
      this.logger.error(`Smart Plan generation failed: ${err.message}`);
      throw new InternalServerErrorException(
        'Failed to generate campaign brief',
      );
    }
  }

  /**
   * Create a DRAFT campaign from confirmed plan fields and attach the brief.
   *
   * Atomicity: CampaignsService.createCampaign manages its own (non-tx-aware) prisma
   * calls and internally resolves/creates the ClientBrand, so it cannot be threaded
   * through a single prisma.$transaction without duplicating its logic (which the plan
   * forbids). We instead use a compensating action: if the brief write fails after the
   * campaign was created, we delete the just-created campaign + its requirements so no
   * orphaned campaign is left behind — the same end guarantee as a rollback.
   * TODO: for a true single-transaction guarantee, refactor CampaignsService.createCampaign
   *       to accept an optional Prisma transaction client and call it inside $transaction here.
   */
  async createCampaignFromPlan(
    userId: string,
    dto: CreateFromPlanDto,
  ): Promise<{ campaignId: string }> {
    const fields = dto.campaignFields ?? {};
    const createDto = this.toCreateCampaignDto(
      fields,
      dto.clientBrandId,
      dto.briefImageUrl,
    );

    // createCampaign forces status DRAFT, resolves clientBrandId for BRAND, and for
    // AGENCY throws BadRequestException('clientBrandId is required for agency users')
    // if dto.clientBrandId is missing — a clear 400 the frontend brand picker prevents.
    const campaign = await this.campaignsService.createCampaign(
      userId,
      createDto,
    );

    try {
      await this.prisma.smartPlanBrief.create({
        data: {
          createdBy: userId,
          campaignId: campaign.id,
          strategy: dto.strategy ?? '',
          concept: dto.concept ?? '',
          briefBody: dto.briefBody ?? '',
          inputMode: 'AI',
        },
      });
    } catch (briefErr: any) {
      // Compensating rollback — remove the campaign we just created
      this.logger.error(
        `Brief attach failed, rolling back campaign ${campaign.id}: ${briefErr.message}`,
      );
      await this.prisma.$transaction([
        this.prisma.campaignRequirement.deleteMany({
          where: { campaignId: campaign.id },
        }),
        this.prisma.campaign.delete({ where: { id: campaign.id } }),
      ]);
      throw new InternalServerErrorException(
        'Failed to attach brief to campaign',
      );
    }

    return { campaignId: campaign.id };
  }

  /**
   * Standalone brief save (no campaign). Kept for the brief-only workspace flow.
   * Now scoped to standalone briefs only: deleteMany targets campaignId: null so a
   * campaign-attached brief is never wiped. One standalone brief per user.
   */
  async saveBrief(userId: string, dto: SaveBriefDto): Promise<{ id: string }> {
    // If a campaignId is supplied, attach to that campaign without deleting others.
    if (dto.campaignId) {
      const brief = await this.prisma.smartPlanBrief.create({
        data: {
          createdBy: userId,
          campaignId: dto.campaignId,
          strategy: dto.strategy ?? '',
          concept: dto.concept ?? '',
          briefBody: dto.briefBody ?? '',
          inputMode: 'AI',
        },
      });
      return { id: brief.id };
    }

    // Standalone path — replace only the user's standalone brief (campaignId: null)
    await this.prisma.smartPlanBrief.deleteMany({
      where: { createdBy: userId, campaignId: null },
    });

    const brief = await this.prisma.smartPlanBrief.create({
      data: {
        createdBy: userId,
        campaignId: null,
        strategy: dto.strategy ?? '',
        concept: dto.concept ?? '',
        briefBody: dto.briefBody ?? '',
        inputMode: 'AI',
      },
    });
    return { id: brief.id };
  }

  /**
   * Restore-on-mount for the brief-only workspace. Now that multiple briefs can
   * coexist, this returns the user's most recent STANDALONE brief (campaignId: null)
   * so the brief-only restore behaves exactly as before campaign-scoped briefs existed.
   */
  async getLatestBrief(userId: string): Promise<GeneratedBrief | null> {
    const brief = await this.prisma.smartPlanBrief.findFirst({
      where: { createdBy: userId, campaignId: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!brief) return null;
    return {
      strategy: brief.strategy ?? '',
      concept: brief.concept ?? '',
      briefBody: brief.briefBody ?? '',
    };
  }

  /** Returns the brief attached to a specific campaign, or null. */
  async getBriefByCampaign(campaignId: string): Promise<GeneratedBrief | null> {
    const brief = await this.prisma.smartPlanBrief.findFirst({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    if (!brief) return null;
    return {
      strategy: brief.strategy ?? '',
      concept: brief.concept ?? '',
      briefBody: brief.briefBody ?? '',
    };
  }

  /**
   * Delete the current brief. With a campaignId, removes that campaign's brief(s);
   * otherwise removes the user's standalone brief (campaignId: null). Scoped to the
   * owner (createdBy) so one user can't delete another's brief. Idempotent — deleting
   * when nothing exists returns { deleted: 0 }.
   */
  async deleteBrief(
    userId: string,
    campaignId?: string,
  ): Promise<{ deleted: number }> {
    const res = await this.prisma.smartPlanBrief.deleteMany({
      where: { createdBy: userId, campaignId: campaignId ?? null },
    });
    return { deleted: res.count };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Build provenance lists so the frontend can show "you provided" vs "AI suggested". */
  buildProvenance(
    dto: GenerateBriefDto,
    campaignFields: PlanCampaignFields,
  ): Provenance {
    const aiSuggested: string[] = [];
    const collect = (obj: any, prefix = '') => {
      for (const [key, value] of Object.entries(obj ?? {})) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value)
        ) {
          collect(value, path);
        } else {
          aiSuggested.push(path);
        }
      }
    };
    collect(campaignFields);

    // rawPrompt mode: the user gave prose, not fields — everything is AI-suggested
    if (dto.rawPrompt) {
      return { userProvided: [], aiSuggested };
    }

    // Form mode: map non-empty GenerateBriefDto inputs to the campaignFields they fed.
    // dto key -> campaignFields path(s) it directly provides
    const inputToField: Record<string, string> = {
      campaignName: 'name',
      objective: 'objective',
      budget: 'budget',
      doDont: 'doAndDont',
      // contentAngle / productInfo / ctaMessage feed keyMessage; targetAudience feeds
      // requirements.locations/categories — treated as user-provided when present.
    };

    const userProvided: string[] = [];
    const isFilled = (v: unknown) => v != null && String(v).trim() !== '';

    for (const [inputKey, fieldPath] of Object.entries(inputToField)) {
      if (isFilled((dto as any)[inputKey]) && aiSuggested.includes(fieldPath)) {
        userProvided.push(fieldPath);
      }
    }
    if (
      [dto.contentAngle, dto.productInfo, dto.ctaMessage].some(isFilled) &&
      aiSuggested.includes('keyMessage')
    ) {
      userProvided.push('keyMessage');
    }
    if (isFilled(dto.targetAudience)) {
      if (aiSuggested.includes('requirements.locations'))
        userProvided.push('requirements.locations');
      if (aiSuggested.includes('requirements.categories'))
        userProvided.push('requirements.categories');
    }

    const userSet = new Set(userProvided);
    return {
      userProvided,
      aiSuggested: aiSuggested.filter((p) => !userSet.has(p)),
    };
  }

  /** Coerce AI campaignFields into the shape CampaignsService.createCampaign expects. */
  private toCreateCampaignDto(
    fields: PlanCampaignFields,
    clientBrandId?: string,
    briefImageUrl?: string,
  ): CreateCampaignDto {
    const dto = new CreateCampaignDto();
    if (briefImageUrl) dto.briefImageUrl = briefImageUrl;
    dto.name =
      (fields.name && String(fields.name).trim()) || 'Untitled campaign';
    if (fields.objective != null) dto.objective = String(fields.objective);
    if (fields.budget != null) {
      const n = Number(fields.budget);
      if (Number.isFinite(n)) dto.budget = n;
    }
    if (fields.visibility != null) dto.visibility = String(fields.visibility);
    if (fields.paymentType != null)
      dto.paymentType = String(fields.paymentType);
    if (fields.keyMessage != null) dto.keyMessage = String(fields.keyMessage);
    if (fields.doAndDont != null) dto.doAndDont = String(fields.doAndDont);
    if (fields.deliverables != null)
      dto.deliverables = String(fields.deliverables);
    // Dates pass through as-is (createCampaign parseDate's them) — usually null per generate()
    if (fields.applyDeadline) dto.applyDeadline = fields.applyDeadline;
    if (fields.submissionDate) dto.submissionDate = fields.submissionDate;
    if (fields.reviewDate) dto.reviewDate = fields.reviewDate;
    if (fields.paymentDate) dto.paymentDate = fields.paymentDate;
    if (clientBrandId) dto.clientBrandId = clientBrandId;

    const r = fields.requirements;
    if (r) {
      const req: any = {};
      if (r.minFollowers != null)
        req.minFollowers = Math.round(Number(r.minFollowers));
      if (r.minEngagementRate != null)
        req.minEngagementRate = Number(r.minEngagementRate);
      if (r.minAvgViews != null)
        req.minAvgViews = Math.round(Number(r.minAvgViews));
      if (Array.isArray(r.platforms) && r.platforms.length)
        req.platforms = r.platforms;
      if (Array.isArray(r.locations) && r.locations.length)
        req.locations = r.locations;
      if (Array.isArray(r.categories) && r.categories.length)
        req.categories = r.categories;
      if (r.contentType != null) req.contentType = String(r.contentType);
      // Wrap the single requirements object as an array
      if (Object.keys(req).length) dto.requirements = [req];
    }

    return dto;
  }

  /** Remove null/undefined keys (recursively) so empty AI values aren't force-written. */
  private stripNulls<T extends Record<string, any>>(obj: T): T {
    const out: any = Array.isArray(obj) ? [] : {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'object' && !Array.isArray(value)) {
        const nested = this.stripNulls(value);
        if (Object.keys(nested).length) out[key] = nested;
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  private buildStructuredContext(dto: GenerateBriefDto): string {
    const lines = [
      dto.campaignName && `Campaign Name: ${dto.campaignName}`,
      dto.objective && `Objective: ${dto.objective}`,
      dto.contentAngle && `Content Angle: ${dto.contentAngle}`,
      dto.productInfo && `Product Info: ${dto.productInfo}`,
      dto.productLinkOrWebsite && `Product Link: ${dto.productLinkOrWebsite}`,
      dto.ctaMessage && `CTA Message: ${dto.ctaMessage}`,
      dto.targetAudience && `Target Audience: ${dto.targetAudience}`,
      dto.brandTone && `Brand Tone: ${dto.brandTone}`,
      dto.budget && `Budget: ${dto.budget}`,
      dto.timeline && `Timeline: ${dto.timeline}`,
      dto.kpi && `KPI: ${dto.kpi}`,
      dto.doDont && `Do & Don't: ${dto.doDont}`,
    ].filter(Boolean);

    return `Campaign Requirements:\n${lines.length ? lines.join('\n') : 'No requirements provided.'}`;
  }
}
