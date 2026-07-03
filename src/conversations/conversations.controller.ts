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
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

const BASE = process.env.UPLOAD_BASE_DIR || './uploads';
const UPLOAD_DIR = `${BASE}/conversations`;

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
      storage: diskStorage({
        destination: (req, file, cb) => {
          try {
            if (!existsSync(UPLOAD_DIR))
              mkdirSync(UPLOAD_DIR, { recursive: true });
            cb(null, UPLOAD_DIR);
          } catch (err) {
            cb(err as Error, UPLOAD_DIR);
          }
        },
        filename: (req, file, cb) =>
          cb(
            null,
            `${Date.now()}-${Math.round(Math.random() * 1e6)}${extname(file.originalname)}`,
          ),
      }),
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
    const fileUrl = `/uploads/conversations/${file.filename}`;
    return this.conversationsService.saveAttachment(
      req.user.userId,
      id,
      type,
      fileUrl,
    );
  }
}
