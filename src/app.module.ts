import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { InfluencersModule } from './influencers/influencers.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ProfileModule } from './profile/profile.module';
import { SyncModule } from './sync/sync.module';
import { SmartPlanModule } from './smart-plan/smart-plan.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { PlatformConnectModule } from './platform-connect/platform-connect.module';
import { ShortlistModule } from './shortlist/shortlist.module';
import { InvitationsModule } from './invitations/invitations.module';
import { DraftsModule } from './drafts/drafts.module';
import { PaymentsModule } from './payments/payments.module';
import { TrackingModule } from './tracking/tracking.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: process.env.REDIS_URL
        ? { url: process.env.REDIS_URL }
        : {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
          },
    }),
    // Enables @Cron handlers (the daily YouTube tracking sync). Registered once
    // here; the job itself is gated behind YOUTUBE_SYNC_ENABLED (default OFF).
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    DashboardModule,
    InfluencersModule,
    ConversationsModule,
    ProfileModule,
    SyncModule,
    SmartPlanModule,
    CampaignsModule,
    PlatformConnectModule,
    ShortlistModule,
    InvitationsModule,
    DraftsModule,
    PaymentsModule,
    TrackingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
