import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CampaignsController } from './campaigns.controller';
import { PublicCampaignController } from './public-campaign.controller';
import { CampaignsService } from './campaigns.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [
    PrismaModule,
    ConversationsModule,
    // Rate-limit config for the ThrottlerGuard applied ONLY on the public campaign
    // route (see PublicCampaignController). Registering forRoot here (module-scoped,
    // controller-level @UseGuards — not APP_GUARD) keeps throttling off the rest of
    // the authenticated API. Mirrors the tracking module's public endpoint.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
  ],
  controllers: [CampaignsController, PublicCampaignController],
  providers: [CampaignsService],
  exports: [CampaignsService], // consumed by SmartPlanModule for the create-campaign flow
})
export class CampaignsModule {}
