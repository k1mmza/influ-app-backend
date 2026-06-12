import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
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
import { YouTubeConnectModule } from './youtube-connect/youtube-connect.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),
    PrismaModule,
    AuthModule,
    DashboardModule,
    InfluencersModule,
    ConversationsModule,
    ProfileModule,
    SyncModule,
    SmartPlanModule,
    CampaignsModule,
    YouTubeConnectModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
