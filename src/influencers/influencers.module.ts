import { Module } from '@nestjs/common';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';
import { TtlService } from './ttl.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InfluencersController],
  providers: [InfluencersService, TtlService],
  exports: [TtlService],
})
export class InfluencersModule {}
