import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { YouTubeConnectController } from './youtube-connect.controller';
import { YouTubeConnectService } from './youtube-connect.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'super-secret-key-change-me-later',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [YouTubeConnectController],
  providers: [YouTubeConnectService],
  exports: [YouTubeConnectService],
})
export class YouTubeConnectModule {}
