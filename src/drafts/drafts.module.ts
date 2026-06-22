import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';

@Module({
  // ConversationsModule exports ChatGateway for live drafts-update broadcasts.
  imports: [PrismaModule, ConversationsModule],
  controllers: [DraftsController],
  providers: [DraftsService],
})
export class DraftsModule {}
