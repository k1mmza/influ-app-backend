import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// PrismaModule is global — no import needed for PrismaService (used by both
// AdminService and RolesGuard).
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
