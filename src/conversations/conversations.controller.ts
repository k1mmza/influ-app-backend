import { Controller, Get, Post, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private conversationsService: ConversationsService) {}

  @Get()
  findAll(@Request() req) {
    return this.conversationsService.findAll(req.user.userId);
  }

  @Post()
  createOrFind(
    @Request() req,
    @Body('influencerId') influencerId: string,
    @Body('campaignId') campaignId: string,
  ) {
    return this.conversationsService.createOrFind(req.user.userId, influencerId, campaignId);
  }

  @Get(':id/messages')
  findMessages(@Param('id') id: string) {
    return this.conversationsService.findMessages(id);
  }

  @Post(':id/messages')
  sendMessage(@Request() req, @Param('id') id: string, @Body('content') content: string) {
    return this.conversationsService.sendMessage(req.user.userId, id, content);
  }

  @Patch(':id/phase')
  updatePhase(@Param('id') id: string, @Body('workPhase') workPhase: string) {
    return this.conversationsService.updatePhase(id, workPhase);
  }

  @Patch(':id/read')
  markAsRead(@Request() req, @Param('id') id: string) {
    return this.conversationsService.markAsRead(id, req.user.userId);
  }
}
