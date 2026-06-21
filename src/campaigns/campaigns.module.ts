import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [PrismaModule, ConversationsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService], // consumed by SmartPlanModule for the create-campaign flow
})
export class CampaignsModule {}
