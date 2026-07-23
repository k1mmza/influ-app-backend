import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('notify');

/**
 * Best-effort notification insert. Swallows errors so a failed notification can
 * never break the action that triggered it. A plain function (not a Nest module)
 * — callers pass their own PrismaService. The Notification read side already
 * lives in DashboardService (Recent Activity); this is the write side.
 * ponytail: fire-and-forget insert, no retry/queue — add one if delivery matters.
 */
export async function notify(
  prisma: PrismaService,
  input: {
    userId: string | null | undefined;
    type: string;
    title: string;
    body?: string;
    referenceId?: string | null;
  },
): Promise<void> {
  if (!input.userId) return; // no recipient user (e.g. external influencer) → skip

  // Respect the recipient's notification preferences (Profile → Settings). Only
  // creators have these; brand/agency recipients have no InfluencerProfile row and
  // always receive. MESSAGE_* types honor messageAlerts; everything else (campaign
  // invitations, applications, draft reviews) honors campaignAlerts.
  try {
    const prefs = await prisma.influencerProfile.findUnique({
      where: { userId: input.userId },
      select: { messageAlerts: true, campaignAlerts: true },
    });
    if (prefs) {
      const isMessage = input.type.startsWith('MESSAGE');
      const allowed = isMessage ? prefs.messageAlerts : prefs.campaignAlerts;
      if (!allowed) return; // recipient opted out of this category
    }
  } catch (e: any) {
    // Pref lookup failed — fall through and deliver rather than drop the notice.
    logger.warn(`notify(${input.type}) pref check failed for user ${input.userId}: ${e.message}`);
  }

  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        referenceId: input.referenceId ?? null,
      },
    });
  } catch (e: any) {
    logger.warn(`notify(${input.type}) failed for user ${input.userId}: ${e.message}`);
  }
}
