import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [PrismaModule, ConversationsModule],
  controllers: [InvitationsController],
  // RolesGuard listed here so its Reflector + PrismaService deps resolve (DI lesson from Shortlist).
  providers: [InvitationsService, RolesGuard],
})
export class InvitationsModule {}
