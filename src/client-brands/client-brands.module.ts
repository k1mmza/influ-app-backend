import { Module } from '@nestjs/common';
import { ClientBrandsController } from './client-brands.controller';
import { ClientBrandsService } from './client-brands.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [PrismaModule],
  controllers: [ClientBrandsController],
  providers: [ClientBrandsService, RolesGuard],
})
export class ClientBrandsModule {}
