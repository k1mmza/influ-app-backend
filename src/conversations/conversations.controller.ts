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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Conversations')
@ApiBearerAuth('jwt')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private conversationsService: ConversationsService) {}

  @ApiOperation({ summary: 'List conversations for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Conversation list.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @Get()
  findAll(@Request() req) {
    return this.conversationsService.findAll(req.user.userId);
  }

  @ApiOperation({ summary: 'Create or find a conversation', description: 'Idempotent: returns the existing conversation for (campaignId, influencerId) if one already exists.' })
  @ApiBody({ schema: { type: 'object', properties: { influencerId: { type: 'string' }, campaignId: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: 'Conversation created or found.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
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

  // Removed: PATCH /conversations/:id/phase (updatePhase) — unguarded, gate-bypassing
  // phase set with no consumer. Phase changes go through POST /:id/phase-ready.

  @ApiOperation({ summary: 'Get messages in a conversation' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiResponse({ status: 200, description: 'Message list.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found or caller is not a participant.', type: ErrorResponseDto })
  @Get(':id/messages')
  findMessages(@Request() req, @Param('id') id: string) {
    return this.conversationsService.findMessages(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Send a message in a conversation' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiBody({ schema: { type: 'object', properties: { content: { type: 'string' } } } })
  @ApiResponse({ status: 201, description: 'Message sent.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found or caller is not a participant.', type: ErrorResponseDto })
  @Post(':id/messages')
  sendMessage(
    @Request() req,
    @Param('id') id: string,
    @Body('content') content: string,
  ) {
    return this.conversationsService.sendMessage(req.user.userId, id, content);
  }

  @ApiOperation({ summary: 'Mark a conversation as read' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiResponse({ status: 200, description: 'Marked as read.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found or caller is not a participant.', type: ErrorResponseDto })
  @Patch(':id/read')
  markAsRead(@Request() req, @Param('id') id: string) {
    return this.conversationsService.markAsRead(id, req.user.userId);
  }

  @ApiOperation({ summary: 'Mark caller\'s side ready to advance the work phase' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiResponse({ status: 201, description: 'Phase-ready state updated; phase advances once both sides are ready.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found or caller is not a participant.', type: ErrorResponseDto })
  @Post(':id/phase-ready')
  markPhaseReady(@Request() req, @Param('id') id: string) {
    return this.conversationsService.markPhaseReady(id, req.user.userId);
  }

  @ApiOperation({ summary: 'Get the campaign brief attached to a conversation' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiResponse({ status: 200, description: 'Campaign brief.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found or caller is not a participant.', type: ErrorResponseDto })
  @Get(':id/brief')
  getBrief(@Request() req, @Param('id') id: string) {
    return this.conversationsService.getBrief(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Get a conversation by id' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiResponse({ status: 200, description: 'Conversation detail.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found or caller is not a participant.', type: ErrorResponseDto })
  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.conversationsService.findOne(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Upload a conversation attachment', description: 'Max 10MB. Accepts pdf, jpeg, jpg, png, webp.' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Attachment saved.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Conversation not found or caller is not a participant.', type: ErrorResponseDto })
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
