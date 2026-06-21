import { Module } from '@nestjs/common';
import { ShortlistController } from './shortlist.controller';
import { ShortlistService } from './shortlist.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [PrismaModule],
  controllers: [ShortlistController],
  providers: [ShortlistService, RolesGuard],
})
export class ShortlistModule {}
