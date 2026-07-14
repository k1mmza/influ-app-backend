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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Controller('conversations/:id/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Get()
  @Roles(UserRole.INFLUENCER, UserRole.BRAND, UserRole.AGENCY)
  list(@Request() req, @Param('id') conversationId: string) {
    return this.paymentsService.list(req.user.userId, conversationId);
  }

  @Post()
  @Roles(UserRole.BRAND, UserRole.AGENCY)
  create(
    @Request() req,
    @Param('id') conversationId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.create(req.user.userId, conversationId, dto);
  }

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
