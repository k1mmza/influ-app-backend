import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AdminService } from './admin.service';
import { PlatformConnectService } from '../platform-connect/platform-connect.service';

/**
 * The entire ADMIN privilege surface: two read-only endpoints.
 *
 * Deliberately NOT included — campaign detail, conversations, tracking, and
 * every mutation. Widening this is a separate decision with its own review;
 * nothing here should be taken as a precedent for adding ADMIN to existing
 * @Roles lists on ownership-scoped routes.
 *
 * RolesGuard reads the role from the DB per request, not from the JWT, so a
 * demotion takes effect immediately rather than at token expiry.
 */
@ApiTags('Admin')
@ApiBearerAuth('jwt')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    // Sync is a write, so it lives on PlatformConnectService (which owns sync
    // writes), not on the deliberately read-only AdminService. The controller
    // is @Roles(ADMIN)-gated, so this platform-wide trigger stays admin-only.
    private readonly platformConnect: PlatformConnectService,
  ) {}

  @ApiOperation({
    summary: 'List all campaigns across every brand and agency',
    description:
      'Admin-only, read-only. Unlike GET /campaigns this applies no ownership filter. Soft-deleted campaigns remain excluded.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Default 1.' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'Default 20.' })
  @ApiResponse({ status: 200, description: 'Paginated campaign list.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not an ADMIN.', type: ErrorResponseDto })
  @Get('campaigns')
  getAllCampaigns(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.adminService.getAllCampaigns(page, pageSize);
  }

  @ApiOperation({ summary: 'Platform-wide dashboard counts' })
  @ApiResponse({ status: 200, description: 'Aggregate counts.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not an ADMIN.', type: ErrorResponseDto })
  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboard();
  }

  @ApiOperation({
    summary: 'Trigger a platform-wide sync of all connected accounts',
    description:
      'Admin-only. Runs an on-demand sync across every connected platform account, bypassing the TTL schedule. Returns { synced, total }.',
  })
  @ApiResponse({ status: 201, description: 'Sync run complete.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not an ADMIN.', type: ErrorResponseDto })
  @Post('sync')
  triggerSync() {
    return this.platformConnect.syncAllAccounts();
  }
}
