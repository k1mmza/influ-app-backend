import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ClientBrandsService } from './client-brands.service';
import { CreateManagedBrandDto } from './dto/create-managed-brand.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ClientBrandResponseDto } from './dto/client-brand-response.dto';

@ApiTags('Client Brands')
@ApiBearerAuth('jwt')
@Controller('client-brands')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.BRAND, UserRole.AGENCY)
export class ClientBrandsController {
  constructor(private readonly clientBrandsService: ClientBrandsService) {}

  @ApiOperation({
    summary: 'List client brands the caller may create campaigns against',
    description: 'Role: BRAND, AGENCY. AGENCY sees every brand it manages; BRAND sees its own self-registered brand.',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({ status: 200, description: 'Client brand list.', type: [ClientBrandResponseDto] })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
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
  @ApiOperation({
    summary: 'Create an agency-managed brand',
    description: 'Role: AGENCY only (overrides the class-level BRAND/AGENCY default — a BRAND token is rejected). Creates an unclaimed ClientBrand with origin=AGENCY_MANAGED, no login.',
  })
  @ApiResponse({ status: 201, description: 'Managed brand created.', type: ClientBrandResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not AGENCY.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'User not found.', type: ErrorResponseDto })
  @Post()
  @Roles(UserRole.AGENCY)
  createManagedBrand(@Request() req: any, @Body() dto: CreateManagedBrandDto) {
    return this.clientBrandsService.createManagedBrand(req.user.userId, dto);
  }
}
