import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
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
    return this.conversationsService.createOrFind(
      req.user.userId,
      influencerId,
      campaignId,
    );
  }

  @Get(':id/messages')
  findMessages(@Request() req, @Param('id') id: string) {
    return this.conversationsService.findMessages(req.user.userId, id);
  }

  @Post(':id/messages')
  sendMessage(
    @Request() req,
    @Param('id') id: string,
    @Body('content') content: string,
  ) {
    return this.conversationsService.sendMessage(req.user.userId, id, content);
  }

  // Removed: PATCH /conversations/:id/phase (updatePhase) — unguarded, gate-bypassing
  // phase set with no consumer. Phase changes go through POST /:id/phase-ready.

  @Patch(':id/read')
  markAsRead(@Request() req, @Param('id') id: string) {
    return this.conversationsService.markAsRead(id, req.user.userId);
  }

  @Post(':id/phase-ready')
  markPhaseReady(@Request() req, @Param('id') id: string) {
    return this.conversationsService.markPhaseReady(id, req.user.userId);
  }

  @Get(':id/brief')
  getBrief(@Request() req, @Param('id') id: string) {
    return this.conversationsService.getBrief(req.user.userId, id);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.conversationsService.findOne(req.user.userId, id);
  }

  @Post(':id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = /pdf|jpeg|jpg|png|webp/i;
        cb(null, allowed.test(extname(file.originalname)));
      },
    }),
  )
  uploadFile(
    @Request() req,
    @Param('id') id: string,
    @Body('type') type: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.conversationsService.saveAttachment(
      req.user.userId,
      id,
      type,
      file,
    );
  }
}
