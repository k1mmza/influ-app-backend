import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationAccessService } from './conversation-access.service';
import { ChatGateway } from './chat.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule re-exports JwtModule so ChatGateway can verify handshake tokens.
  imports: [PrismaModule, AuthModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationAccessService, ChatGateway],
  // Exported so CampaignsService (application-accept) and InvitationsService (invite-accept)
  // can reuse ensureConversation — the single shared conversation find-or-create.
  // ChatGateway is exported so DraftsModule/PaymentsModule can broadcast live updates.
  // ConversationAccessService is exported for any other module needing the participant check.
  exports: [ConversationsService, ChatGateway, ConversationAccessService],
})
export class ConversationsModule {}
