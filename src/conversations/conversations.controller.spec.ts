import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AUTH_PASS, AUTH_FAIL, initApp, TEST_USER_ID } from '../test-utils';

const svc = {
  findAll: jest.fn(),
  createOrFind: jest.fn(),
  findOne: jest.fn(),
  findMessages: jest.fn(),
  sendMessage: jest.fn(),
  markAsRead: jest.fn(),
  markPhaseReady: jest.fn(),
  getBrief: jest.fn(),
  saveAttachment: jest.fn(),
};

async function buildApp(jwtMock: object) {
  const module = await Test.createTestingModule({
    controllers: [ConversationsController],
    providers: [{ provide: ConversationsService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .compile();
  return initApp(module);
}

describe('ConversationsController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /conversations', () => {
    it('200 returns conversations for user', async () => {
      svc.findAll.mockResolvedValueOnce([{ id: 'conv-1' }]);
      const res = await request(app.getHttpServer())
        .get('/conversations')
        .expect(200);
      expect(res.body).toEqual([{ id: 'conv-1' }]);
      expect(svc.findAll).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });

  describe('POST /conversations', () => {
    it('201 creates or returns existing conversation', async () => {
      svc.createOrFind.mockResolvedValueOnce({ id: 'conv-1' });
      const res = await request(app.getHttpServer())
        .post('/conversations')
        .send({ influencerId: 'inf-1', campaignId: 'camp-1' })
        .expect(201);
      expect(res.body.id).toBe('conv-1');
      expect(svc.createOrFind).toHaveBeenCalledWith(
        TEST_USER_ID,
        'inf-1',
        'camp-1',
      );
    });
  });

  describe('GET /conversations/:id', () => {
    it('200 returns single conversation', async () => {
      svc.findOne.mockResolvedValueOnce({ id: 'conv-1' });
      const res = await request(app.getHttpServer())
        .get('/conversations/conv-1')
        .expect(200);
      expect(res.body.id).toBe('conv-1');
    });

    it('404 when conversation not found', async () => {
      svc.findOne.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .get('/conversations/nonexistent')
        .expect(404);
    });
  });

  describe('GET /conversations/:id/messages', () => {
    it('200 returns messages for conversation', async () => {
      svc.findMessages.mockResolvedValueOnce([
        { id: 'msg-1', content: 'Hello' },
      ]);
      const res = await request(app.getHttpServer())
        .get('/conversations/conv-1/messages')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(svc.findMessages).toHaveBeenCalledWith(TEST_USER_ID, 'conv-1');
    });
  });

  describe('POST /conversations/:id/messages', () => {
    it('201 sends a message', async () => {
      svc.sendMessage.mockResolvedValueOnce({ id: 'msg-1', content: 'Hello' });
      await request(app.getHttpServer())
        .post('/conversations/conv-1/messages')
        .send({ content: 'Hello' })
        .expect(201);
      expect(svc.sendMessage).toHaveBeenCalledWith(
        TEST_USER_ID,
        'conv-1',
        'Hello',
      );
    });
  });

  describe('PATCH /conversations/:id/read', () => {
    it('200 marks conversation as read', async () => {
      svc.markAsRead.mockResolvedValueOnce({ success: true });
      await request(app.getHttpServer())
        .patch('/conversations/conv-1/read')
        .expect(200);
      expect(svc.markAsRead).toHaveBeenCalledWith('conv-1', TEST_USER_ID);
    });
  });

  describe('POST /conversations/:id/phase-ready', () => {
    it('201 marks phase as ready', async () => {
      svc.markPhaseReady.mockResolvedValueOnce({ success: true });
      await request(app.getHttpServer())
        .post('/conversations/conv-1/phase-ready')
        .expect(201);
      expect(svc.markPhaseReady).toHaveBeenCalledWith('conv-1', TEST_USER_ID);
    });
  });

  describe('GET /conversations/:id/brief', () => {
    it('200 returns brief for conversation', async () => {
      svc.getBrief.mockResolvedValueOnce({ id: 'brief-1' });
      const res = await request(app.getHttpServer())
        .get('/conversations/conv-1/brief')
        .expect(200);
      expect(res.body.id).toBe('brief-1');
      expect(svc.getBrief).toHaveBeenCalledWith(TEST_USER_ID, 'conv-1');
    });
  });

  describe('POST /conversations/:id/upload', () => {
    it('201 uploads file and saves attachment', async () => {
      svc.saveAttachment.mockResolvedValueOnce({
        url: '/uploads/conversations/test.jpg',
      });
      await request(app.getHttpServer())
        .post('/conversations/conv-1/upload')
        .attach('file', Buffer.from('fake-image-data'), {
          filename: 'test.jpg',
          contentType: 'image/jpeg',
        })
        .field('type', 'image')
        .expect(201);
      expect(svc.saveAttachment).toHaveBeenCalledWith(
        TEST_USER_ID,
        'conv-1',
        'image',
        expect.stringContaining('/uploads/conversations/'),
      );
    });
  });

  describe('Auth failures', () => {
    let noAuthApp: any;

    beforeAll(async () => {
      noAuthApp = await buildApp(AUTH_FAIL);
    });
    afterAll(() => noAuthApp.close());

    it('401 GET /conversations without token', async () => {
      await request(noAuthApp.getHttpServer())
        .get('/conversations')
        .expect(401);
    });

    it('401 POST /conversations without token', async () => {
      await request(noAuthApp.getHttpServer())
        .post('/conversations')
        .send({})
        .expect(401);
    });
  });
});
