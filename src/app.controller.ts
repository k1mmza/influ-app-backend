import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({
    summary: 'Liveness check',
    description:
      'Public — no authentication required. Returns 200 if the process is up. For a readiness check that also verifies the database and Redis, use GET /health.',
  })
  @ApiResponse({ status: 200, description: 'Process is up.' })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
