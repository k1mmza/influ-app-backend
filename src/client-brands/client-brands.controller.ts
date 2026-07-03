import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ClientBrandsService } from './client-brands.service';
import { CreateManagedBrandDto } from './dto/create-managed-brand.dto';

@Controller('client-brands')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BRAND, UserRole.AGENCY)
export class ClientBrandsController {
  constructor(private readonly clientBrandsService: ClientBrandsService) {}

  @Get()
  getClientBrands(@Request() req: any, @Query('search') search?: string) {
    return this.clientBrandsService.getClientBrandsForUser(
      req.user.userId,
      search,
    );
  }

  // Method-level @Roles overrides the class default (RolesGuard uses
  // getAllAndOverride), so this write path is AGENCY-only — a BRAND token is
  // rejected at the guard, and the service re-checks the role as defense-in-depth.
  @Post()
  @Roles(UserRole.AGENCY)
  createManagedBrand(@Request() req: any, @Body() dto: CreateManagedBrandDto) {
    return this.clientBrandsService.createManagedBrand(req.user.userId, dto);
  }
}
