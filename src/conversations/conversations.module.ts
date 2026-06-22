import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ChatGateway } from './chat.gateway';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ChatGateway],
  // Exported so CampaignsService (application-accept) and InvitationsService (invite-accept)
  // can reuse ensureConversation — the single shared conversation find-or-create.
  // ChatGateway is exported so DraftsModule/PaymentsModule can broadcast live updates.
  exports: [ConversationsService, ChatGateway],
})
export class ConversationsModule {}
