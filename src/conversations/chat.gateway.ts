import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationAccessService } from './conversation-access.service';

// CORS matches the REST API (main.ts): the single configured frontend origin,
// not '*'. FRONTEND_URL falls back to localhost for dev.
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3000';

@WebSocketGateway({
  cors: { origin: FRONTEND_ORIGIN, credentials: true },
})
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly access: ConversationAccessService,
  ) {}

  /**
   * Handshake auth: verify the JWT on connect (same secret as the REST guard),
   * reject unauthenticated/deleted-user sockets. The verified userId is stashed
   * on client.data for later participant checks. Mirrors JwtStrategy.validate.
   */
  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.query?.token as string | undefined);
      if (!token) throw new Error('No token');

      const payload = await this.jwt.verifyAsync(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isDeleted: true },
      });
      if (!user || user.isDeleted) throw new Error('Account no longer active');

      client.data.userId = payload.sub;
    } catch {
      // Don't leak the reason to the client; just refuse the socket.
      client.disconnect();
    }
  }

  @SubscribeMessage('join-conversation')
  async handleJoin(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      client.disconnect();
      return;
    }
    try {
      // Same participant check as the REST endpoints — reused, not reimplemented.
      await this.access.resolveParticipant(userId, conversationId);
      client.join(`conversation:${conversationId}`);
    } catch {
      // Not a participant (or bad id) — refuse the room, tell the client.
      client.emit('join-denied', { conversationId });
    }
  }

  @SubscribeMessage('leave-conversation')
  handleLeave(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`conversation:${conversationId}`);
  }

  emitNewMessage(conversationId: string, message: any) {
    this.server
      .to(`conversation:${conversationId}`)
      .emit('new-message', message);
  }

  emitPhaseUpdate(
    conversationId: string,
    payload: {
      workPhase: string | null;
      brandPhaseReady: boolean;
      influencerPhaseReady: boolean;
    },
  ) {
    this.server
      .to(`conversation:${conversationId}`)
      .emit('phase-update', payload);
  }

  // Signals participants to refetch drafts after a create/edit/delete/review.
  emitDraftsUpdate(conversationId: string) {
    this.server
      .to(`conversation:${conversationId}`)
      .emit('drafts-update', { conversationId });
  }

  // Signals participants to refetch payments after a create/proof/confirm.
  emitPaymentsUpdate(conversationId: string) {
    this.server
      .to(`conversation:${conversationId}`)
      .emit('payments-update', { conversationId });
  }
}
