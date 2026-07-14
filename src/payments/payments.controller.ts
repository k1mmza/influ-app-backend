import {
  Body,
  Controller,
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
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ErrorResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Payments')
@ApiBearerAuth('jwt')
@Controller('conversations/:id/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @ApiOperation({ summary: 'List payments in a conversation', description: 'Role: INFLUENCER, BRAND, AGENCY (all conversation participants).' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiResponse({ status: 200, description: 'Payment list.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller is not a participant in this conversation.', type: ErrorResponseDto })
  @Get()
  @Roles(UserRole.INFLUENCER, UserRole.BRAND, UserRole.AGENCY)
  list(@Request() req, @Param('id') conversationId: string) {
    return this.paymentsService.list(req.user.userId, conversationId);
  }

  @ApiOperation({ summary: 'Create a payment', description: 'Role: BRAND, AGENCY. Starts a payment in PENDING status.' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiResponse({ status: 201, description: 'Payment created.' })
  @ApiResponse({ status: 400, description: 'Validation failed.', type: ErrorResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @Post()
  @Roles(UserRole.BRAND, UserRole.AGENCY)
  create(
    @Request() req,
    @Param('id') conversationId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.create(req.user.userId, conversationId, dto);
  }

  @ApiOperation({ summary: 'Upload off-platform transfer proof', description: 'Role: BRAND, AGENCY. Max 10MB. Accepts pdf, jpeg, jpg, png, webp. Moves payment to AWAITING_CONFIRMATION.' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiParam({ name: 'paymentId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, description: 'Proof uploaded.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not BRAND or AGENCY.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Payment not found.', type: ErrorResponseDto })
  @Post(':paymentId/proof')
  @Roles(UserRole.BRAND, UserRole.AGENCY)
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
  uploadProof(
    @Request() req,
    @Param('id') conversationId: string,
    @Param('paymentId') paymentId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.paymentsService.uploadProof(
      req.user.userId,
      conversationId,
      paymentId,
      file,
    );
  }

  @ApiOperation({ summary: 'Confirm receipt of payment', description: 'Role: INFLUENCER. Only reachable path to PAID status.' })
  @ApiParam({ name: 'id', description: 'Conversation id' })
  @ApiParam({ name: 'paymentId' })
  @ApiResponse({ status: 200, description: 'Payment confirmed.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token.', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Caller role is not INFLUENCER.', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Payment not found.', type: ErrorResponseDto })
  @Patch(':paymentId/confirm')
  @Roles(UserRole.INFLUENCER)
  confirm(
    @Request() req,
    @Param('id') conversationId: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentsService.confirm(
      req.user.userId,
      conversationId,
      paymentId,
    );
  }
}
