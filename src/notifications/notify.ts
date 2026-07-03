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
