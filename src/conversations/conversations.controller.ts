import {
  Controller, Get, Post, Patch, Body, Param,
  UseGuards, Request, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const UPLOAD_DIR = './uploads/conversations';
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(id);
  }

  @Post(':id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) =>
          cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = /pdf|jpeg|jpg|png|webp/i;
        cb(null, allowed.test(extname(file.originalname)));
      },
    }),
  )
  uploadFile(
    @Param('id') id: string,
    @Body('type') type: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const fileUrl = `/uploads/conversations/${file.filename}`;
    return this.conversationsService.saveAttachment(id, type, fileUrl);
  }
}
