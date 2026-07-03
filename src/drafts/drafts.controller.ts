import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DraftsService } from './drafts.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { ReviewDraftDto } from './dto/review-draft.dto';

// Same upload directory + filename scheme as the conversations multer pipeline,
// so draft files are served via /uploads (Phase 1 URL fix applies unchanged).
const BASE = process.env.UPLOAD_BASE_DIR || './uploads';
const UPLOAD_DIR = `${BASE}/conversations`;

@Controller('conversations/:id/drafts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DraftsController {
  constructor(private draftsService: DraftsService) {}

  @Get()
  @Roles(UserRole.INFLUENCER, UserRole.BRAND, UserRole.AGENCY)
  list(@Request() req, @Param('id') conversationId: string) {
    return this.draftsService.list(req.user.userId, conversationId);
  }

  @Post()
  @Roles(UserRole.INFLUENCER)
  create(
    @Request() req,
    @Param('id') conversationId: string,
    @Body() dto: CreateDraftDto,
  ) {
    return this.draftsService.create(req.user.userId, conversationId, dto);
  }

  @Patch(':draftId')
  @Roles(UserRole.INFLUENCER)
  update(
    @Request() req,
    @Param('id') conversationId: string,
    @Param('draftId') draftId: string,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.draftsService.update(
      req.user.userId,
      conversationId,
      draftId,
      dto,
    );
  }

  @Delete(':draftId')
  @Roles(UserRole.INFLUENCER)
  remove(
    @Request() req,
    @Param('id') conversationId: string,
    @Param('draftId') draftId: string,
  ) {
    return this.draftsService.remove(req.user.userId, conversationId, draftId);
  }

  @Patch(':draftId/review')
  @Roles(UserRole.BRAND, UserRole.AGENCY)
  review(
    @Request() req,
    @Param('id') conversationId: string,
    @Param('draftId') draftId: string,
    @Body() dto: ReviewDraftDto,
  ) {
    return this.draftsService.review(
      req.user.userId,
      conversationId,
      draftId,
      dto,
    );
  }

  @Post(':draftId/upload')
  @Roles(UserRole.INFLUENCER)
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
    @Param('id') conversationId: string,
    @Param('draftId') draftId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const fileUrl = `/uploads/conversations/${file.filename}`;
    const contentType = /pdf$/i.test(file.filename) ? 'pdf' : 'image';
    return this.draftsService.saveUpload(
      req.user.userId,
      conversationId,
      draftId,
      fileUrl,
      contentType,
    );
  }
}
