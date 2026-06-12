import {
  Injectable,
  Logger,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GenerateBriefDto } from './dto/generate-brief.dto';

export interface GeneratedBrief {
  strategy: string;
  concept: string;
  briefBody: string;
}

@Injectable()
export class SmartPlanService {
  private readonly logger = new Logger(SmartPlanService.name);
  private readonly client: Anthropic | null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — Smart Plan generation unavailable');
      this.client = null;
    }
  }

  async generate(dto: GenerateBriefDto): Promise<GeneratedBrief> {
    if (!this.client) {
      throw new ServiceUnavailableException('AI service is not configured');
    }

    const contextBlock = dto.rawPrompt
      ? `User's campaign description:\n"${dto.rawPrompt}"`
      : this.buildStructuredContext(dto);

    const prompt = `You are an expert influencer marketing strategist. Generate a complete campaign plan.

${contextBlock}

Return ONLY a valid JSON object with exactly three string fields — no markdown fences, no extra keys:
- "strategy": Campaign strategy (3-5 concise paragraphs covering audience targeting, channel mix, campaign phasing, and how each KPI will be hit)
- "concept": Creative concept (2-3 paragraphs covering the core creative idea, content formats, messaging angle, and what makes it resonate with the target audience)
- "briefBody": Creator brief ready to hand to influencers (structured with: product overview, key talking points, CTA instructions, content guidelines, dos and don'ts)`;

    try {
      const message = await this.client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw =
        message.content[0].type === 'text' ? message.content[0].text.trim() : '{}';
      const json = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const parsed = JSON.parse(json) as Partial<GeneratedBrief>;
      return {
        strategy: parsed.strategy ?? '',
        concept: parsed.concept ?? '',
        briefBody: parsed.briefBody ?? '',
      };
    } catch (err: any) {
      this.logger.error(`Smart Plan generation failed: ${err.message}`);
      throw new InternalServerErrorException('Failed to generate campaign brief');
    }
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
