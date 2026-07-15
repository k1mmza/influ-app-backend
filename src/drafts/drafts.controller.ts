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
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { UserRole } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DraftsService } from './drafts.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { ReviewDraftDto } from './dto/review-draft.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Drafts')
@ApiBearerAuth('jwt')
@Controller('conversations/:id/drafts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DraftsController {
  constructor(private draftsService: DraftsService) {}

  @ApiOperation({ summary: 'List drafts in a conversation', description: 'Role: INFLUENCER, BRAND, AGENCY (all conversation participants).' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiResponse({ status: 200, description: 'Draft list.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not a participant in this conversation.', type: ErrorResponseDto })
  @Get()
  @Roles(UserRole.INFLUENCER, UserRole.BRAND, UserRole.AGENCY)
  list(@Request() req, @Param('id') conversationId: string) {
    return this.draftsService.list(req.user.userId, conversationId);
  }

  @ApiOperation({ summary: 'Create a draft', description: 'Role: INFLUENCER.' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiResponse({ status: 201, description: 'Draft created.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not INFLUENCER.', type: ErrorResponseDto })
  @Post()
  @Roles(UserRole.INFLUENCER)
  create(
    @Request() req,
    @Param('id') conversationId: string,
    @Body() dto: CreateDraftDto,
  ) {
    return this.draftsService.create(req.user.userId, conversationId, dto);
  }

  @ApiOperation({ summary: 'Update a draft', description: 'Role: INFLUENCER. May only move status between DRAFT and SUBMITTED.' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiParam({ name: 'draftId' })
  @ApiResponse({ status: 200, description: 'Draft updated.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not INFLUENCER.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Draft not found.', type: ErrorResponseDto })
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

  @ApiOperation({ summary: 'Delete a draft', description: 'Role: INFLUENCER.' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiParam({ name: 'draftId' })
  @ApiResponse({ status: 200, description: 'Draft deleted.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not INFLUENCER.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Draft not found.', type: ErrorResponseDto })
  @Delete(':draftId')
  @Roles(UserRole.INFLUENCER)
  remove(
    @Request() req,
    @Param('id') conversationId: string,
    @Param('draftId') draftId: string,
  ) {
    return this.draftsService.remove(req.user.userId, conversationId, draftId);
  }

  @ApiOperation({ summary: 'Review a draft', description: 'Role: BRAND, AGENCY. Sets status to APPROVED or REVISION_REQUESTED (revisionNote required for the latter, enforced in the service).' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiParam({ name: 'draftId' })
  @ApiResponse({ status: 200, description: 'Draft reviewed.' })
  @ApiResponse({ status: 400, description: 'Validation failed, or revisionNote missing for REVISION_REQUESTED.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Draft not found.', type: ErrorResponseDto })
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

  @ApiOperation({ summary: 'Upload a draft attachment', description: 'Role: INFLUENCER. Max 10MB. Accepts pdf, jpeg, jpg, png, webp.' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiParam({ name: 'draftId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, description: 'Attachment saved.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not INFLUENCER.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Draft not found.', type: ErrorResponseDto })
  @Post(':draftId/upload')
  @Roles(UserRole.INFLUENCER)
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
    @Param('id') conversationId: string,
    @Param('draftId') draftId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const contentType = /pdf$/i.test(file.originalname) ? 'pdf' : 'image';
    return this.draftsService.saveUpload(
      req.user.userId,
      conversationId,
      draftId,
      file,
      contentType,
    );
  }
}
