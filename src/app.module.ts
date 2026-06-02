import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { InfluencersModule } from './influencers/influencers.module';
import { ConversationsModule } from './conversations/conversations.module';
import { ProfileModule } from './profile/profile.module';

@Module({
  imports: [PrismaModule, AuthModule, DashboardModule, InfluencersModule, ConversationsModule, ProfileModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
