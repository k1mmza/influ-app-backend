import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformConnectModule } from '../platform-connect/platform-connect.module';

// PrismaModule is global — no import needed for PrismaService (used by both
// AdminService and RolesGuard). PlatformConnectModule is imported for its
// exported PlatformConnectService, which backs the admin manual-sync trigger.
@Module({
  imports: [PlatformConnectModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
