import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformConnectController } from './platform-connect.controller';
import { PlatformConnectService } from './platform-connect.service';
import { YouTubeStrategy } from './strategies/youtube.strategy';
import { TikTokStrategy } from './strategies/tiktok.strategy';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'super-secret-key-change-me-later',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [PlatformConnectController],
  providers: [PlatformConnectService, YouTubeStrategy, TikTokStrategy],
  exports: [PlatformConnectService],
})
export class PlatformConnectModule {}
