import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('join-conversation')
  handleJoin(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`conversation:${conversationId}`);
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
