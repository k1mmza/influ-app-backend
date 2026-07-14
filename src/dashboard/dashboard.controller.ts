import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Dashboard')
@ApiBearerAuth('jwt')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @ApiOperation({ summary: 'Get role-aware dashboard analytics', description: 'Returns aggregated analytics scoped to the authenticated user\'s role (Agency/Brand/Influencer).' })
  @ApiResponse({ status: 200, description: 'Dashboard analytics payload.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Get()
  getDashboardData(@Request() req) {
    return this.dashboardService.getDashboardData(req.user.userId);
  }
}
