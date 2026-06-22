/**
 * TEST PLAN — MediaKitImportService (AI media-kit import, review-and-confirm)
 * ==========================================================================
 * Plain unit tests, direct instantiation, AiAnalysisService hand-mocked so the
 * real Anthropic API is NEVER hit. The whole feature's safety rule is the
 * proposed/claimedMetrics firewall — most cases assert it directly.
 *
 * TC-01: JSON maps known self-reported keys, ignores unknown ones
 * TC-02: metric-like keys (follower_count, engagementRate) route to
 *        claimedMetrics and NEVER appear in proposed
 * TC-03: a follower/ER value never leaks into any proposed field
 * TC-04: categories outside the predefined list are dropped
 * TC-05: malformed JSON → graceful empty proposal + warning, no throw
 * TC-06: image upload → empty proposal + "not supported" warning (no AI call)
 * TC-07: missing file → graceful empty proposal + warning
 * TC-08: PDF path → pdf-parse mocked, AI mocked; claimed metrics from the AI
 *        response stay in claimedMetrics, proposed stays clean, warning present
 * TC-09: nested { mediaKit: {...} } envelope is unwrapped
 */

jest.mock('pdf-parse', () => jest.fn());
import pdfParse from 'pdf-parse';
import { MediaKitImportService } from './media-kit-import.service';

const mockPdf = pdfParse as unknown as jest.Mock;

function jsonFile(obj: unknown) {
  return {
    buffer: Buffer.from(JSON.stringify(obj), 'utf-8'),
    mimetype: 'application/json',
    originalname: 'kit.json',
  };
}

function build(aiResult: Record<string, unknown> | null = null) {
  const ai = { analyzeMediaKit: jest.fn().mockResolvedValue(aiResult) } as any;
  const service = new MediaKitImportService(ai);
  return { service, ai };
}

describe('MediaKitImportService', () => {
  afterEach(() => jest.clearAllMocks());

  it('TC-01: JSON maps known self-reported keys, ignores unknown', async () => {
    const { service, ai } = build();
    const res = await service.analyzeFile(
      jsonFile({
        bio: 'Lifestyle creator in Bangkok',
        categories: ['Beauty', 'Lifestyle'],
        keywords: ['skincare', 'routine'],
        hashtags: ['glowup', '#bkk'],
        availability: 'Available now',
        pricing: { post: 5000, video: 12000, bundle: 30000 },
        somethingRandom: 'ignored',
        internalId: 42,
      }),
    );

    expect(res.source).toBe('json');
    expect(ai.analyzeMediaKit).not.toHaveBeenCalled();
    expect(res.proposed.bio).toBe('Lifestyle creator in Bangkok');
    expect(res.proposed.categories).toEqual(['Beauty', 'Lifestyle']);
    expect(res.proposed.keywords).toEqual(['skincare', 'routine']);
    expect(res.proposed.hashtags).toEqual(['#glowup', '#bkk']);
    expect(res.proposed.availabilityStatus).toBe('Available now');
    expect(res.proposed.rateCard).toEqual({
      pricePerPost: 5000,
      pricePerVideo: 12000,
      packagePrice: 30000,
    });
    // unknown keys are not present anywhere in proposed
    expect(JSON.stringify(res.proposed)).not.toContain('ignored');
    expect(JSON.stringify(res.proposed)).not.toContain('42');
  });

  it('TC-02: metric-like keys route to claimedMetrics, never to proposed', async () => {
    const { service } = build();
    const res = await service.analyzeFile(
      jsonFile({
        bio: 'Creator',
        follower_count: 125000,
        avgViews: 40000,
        engagementRate: 4.7,
        growthRate: 12,
      }),
    );

    expect(res.claimedMetrics).toEqual({
      followers: 125000,
      avgViews: 40000,
      engagementRate: 4.7,
      growthRate: 12,
    });
    // none of these objective metrics exist as writable proposed fields
    expect(res.proposed).not.toHaveProperty('followers');
    expect(res.proposed).not.toHaveProperty('avgViews');
    expect(res.proposed).not.toHaveProperty('engagementRate');
    expect(res.proposed).not.toHaveProperty('growthRate');
  });

  it('TC-03: a follower / ER value never leaks into proposed', async () => {
    const { service } = build();
    const res = await service.analyzeFile(
      jsonFile({
        bio: 'Creator',
        followers: 999999,
        engagement_rate: 8.8,
        categories: ['Fitness'],
      }),
    );
    const proposedDump = JSON.stringify(res.proposed);
    expect(proposedDump).not.toContain('999999');
    expect(proposedDump).not.toContain('8.8');
    expect(res.claimedMetrics.followers).toBe(999999);
    expect(res.claimedMetrics.engagementRate).toBe(8.8);
  });

  it('TC-04: categories outside the predefined list are dropped', async () => {
    const { service } = build();
    const res = await service.analyzeFile(
      jsonFile({ categories: ['Beauty', 'Knitting', 'Crypto', 'Fitness'] }),
    );
    expect(res.proposed.categories).toEqual(['Beauty', 'Fitness']);
  });

  it('TC-05: malformed JSON degrades gracefully (no throw)', async () => {
    const { service } = build();
    const file = {
      buffer: Buffer.from('{ this is not json ', 'utf-8'),
      mimetype: 'application/json',
      originalname: 'broken.json',
    };
    const res = await service.analyzeFile(file);
    expect(res.proposed).toEqual({});
    expect(res.claimedMetrics).toEqual({});
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.source).toBe('json');
  });

  it('TC-06: image upload returns a not-supported warning, no AI call', async () => {
    const { service, ai } = build();
    const res = await service.analyzeFile({
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      mimetype: 'image/jpeg',
      originalname: 'kit.jpg',
    });
    expect(res.source).toBe('image');
    expect(res.proposed).toEqual({});
    expect(res.warnings[0]).toMatch(/not supported/i);
    expect(ai.analyzeMediaKit).not.toHaveBeenCalled();
  });

  it('TC-07: missing file degrades gracefully', async () => {
    const { service } = build();
    const res = await service.analyzeFile(undefined);
    expect(res.proposed).toEqual({});
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('TC-08: PDF path keeps claimed metrics out of proposed', async () => {
    mockPdf.mockResolvedValue({
      text: 'A long media kit document with plenty of extractable text content.',
    });
    const { service, ai } = build({
      bio: 'Travel creator',
      categories: ['Travel', 'NotARealCategory'],
      claimedMetrics: { followers: 80000, engagementRate: 5.1 },
    });
    const res = await service.analyzeFile({
      buffer: Buffer.from('%PDF-1.4 fake'),
      mimetype: 'application/pdf',
      originalname: 'kit.pdf',
    });

    expect(ai.analyzeMediaKit).toHaveBeenCalledTimes(1);
    expect(res.source).toBe('pdf');
    expect(res.proposed.bio).toBe('Travel creator');
    expect(res.proposed.categories).toEqual(['Travel']);
    expect(res.proposed).not.toHaveProperty('followers');
    expect(res.claimedMetrics).toEqual({
      followers: 80000,
      engagementRate: 5.1,
    });
    expect(res.warnings.join(' ')).toMatch(/approximate/i);
  });

  it('TC-08b: image-only PDF (no text) warns instead of guessing', async () => {
    mockPdf.mockResolvedValue({ text: '   ' });
    const { service, ai } = build({ bio: 'should not be used' });
    const res = await service.analyzeFile({
      buffer: Buffer.from('%PDF-1.4 scanned'),
      mimetype: 'application/pdf',
      originalname: 'scan.pdf',
    });
    expect(ai.analyzeMediaKit).not.toHaveBeenCalled();
    expect(res.proposed).toEqual({});
    expect(res.warnings[0]).toMatch(/no extractable text/i);
  });

  it('TC-09: unwraps a { mediaKit: {...} } envelope', async () => {
    const { service } = build();
    const res = await service.analyzeFile(
      jsonFile({ mediaKit: { bio: 'Wrapped bio', categories: ['Gaming'] } }),
    );
    expect(res.proposed.bio).toBe('Wrapped bio');
    expect(res.proposed.categories).toEqual(['Gaming']);
  });
});
