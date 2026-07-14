import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Health check', description: 'Public — no authentication required. Used as the Render deploy health check.' })
  @ApiResponse({ status: 200, description: 'Service is up.' })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
