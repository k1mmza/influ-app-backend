import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { MediaKitImportService } from './media-kit-import.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  AUTH_PASS,
  AUTH_FAIL,
  ROLE_PASS,
  ROLE_FAIL,
  initApp,
  TEST_USER_ID,
} from '../test-utils';

const profileSvc = {
  getProfile: jest.fn(),
  getCompleteness: jest.fn(),
  updateProfile: jest.fn(),
  uploadAvatarFile: jest.fn(),
  uploadRateCardFile: jest.fn(),
  deleteRateCardFile: jest.fn(),
  deleteProfile: jest.fn(),
};

const mediaKitSvc = {
  analyzeFile: jest.fn(),
};

async function buildApp(jwtMock: object, rolesMock: object) {
  const module = await Test.createTestingModule({
    controllers: [ProfileController],
    providers: [
      { provide: ProfileService, useValue: profileSvc },
      { provide: MediaKitImportService, useValue: mediaKitSvc },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .overrideGuard(RolesGuard)
    .useValue(rolesMock)
    .compile();
  return initApp(module);
}

describe('ProfileController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS, ROLE_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /profile', () => {
    it('200 returns profile for authenticated user', async () => {
      profileSvc.getProfile.mockResolvedValueOnce({
        id: TEST_USER_ID,
        name: 'Test User',
      });
      const res = await request(app.getHttpServer())
        .get('/profile')
        .expect(200);
      expect(res.body.id).toBe(TEST_USER_ID);
      expect(profileSvc.getProfile).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL, ROLE_PASS);
      await request(noAuthApp.getHttpServer()).get('/profile').expect(401);
      await noAuthApp.close();
    });
  });

  describe('GET /profile/completeness', () => {
    it('200 returns completeness score', async () => {
      profileSvc.getCompleteness.mockResolvedValueOnce({
        score: 75,
        missing: ['bio'],
      });
      const res = await request(app.getHttpServer())
        .get('/profile/completeness')
        .expect(200);
      expect(res.body.score).toBe(75);
      expect(profileSvc.getCompleteness).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });

  describe('PATCH /profile', () => {
    it('200 updates profile with partial fields', async () => {
      profileSvc.updateProfile.mockResolvedValueOnce({
        id: TEST_USER_ID,
        name: 'New Name',
      });
      await request(app.getHttpServer())
        .patch('/profile')
        .send({ name: 'New Name' })
        .expect(200);
      expect(profileSvc.updateProfile).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ name: 'New Name' }),
      );
    });

    it('200 with empty body (all fields optional)', async () => {
      profileSvc.updateProfile.mockResolvedValueOnce({ id: TEST_USER_ID });
      await request(app.getHttpServer()).patch('/profile').send({}).expect(200);
    });

    it('400 on unrecognised field', async () => {
      await request(app.getHttpServer())
        .patch('/profile')
        .send({ unknownField: 'bad' })
        .expect(400);
    });
  });

  describe('POST /profile/media-kit/analyze', () => {
    it('201 analyzes uploaded media kit file', async () => {
      mediaKitSvc.analyzeFile.mockResolvedValueOnce({
        followers: 10000,
        engagementRate: 3.2,
      });
      const res = await request(app.getHttpServer())
        .post('/profile/media-kit/analyze')
        .attach('file', Buffer.from('{}'), {
          filename: 'media-kit.json',
          contentType: 'application/json',
        })
        .expect(201);
      expect(mediaKitSvc.analyzeFile).toHaveBeenCalled();
    });

    it('403 with wrong role', async () => {
      const noRoleApp = await buildApp(AUTH_PASS, ROLE_FAIL);
      await request(noRoleApp.getHttpServer())
        .post('/profile/media-kit/analyze')
        .attach('file', Buffer.from('{}'), {
          filename: 'kit.json',
          contentType: 'application/json',
        })
        .expect(403);
      await noRoleApp.close();
    });
  });

  describe('POST /profile/avatar', () => {
    it('201 uploads avatar and returns file URL', async () => {
      profileSvc.uploadAvatarFile.mockResolvedValueOnce({
        avatarUrl: '/uploads/avatars/test.jpg',
      });
      const res = await request(app.getHttpServer())
        .post('/profile/avatar')
        .attach('file', Buffer.from('fake-image'), {
          filename: 'avatar.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
      expect(profileSvc.uploadAvatarFile).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ originalname: 'avatar.jpg' }),
      );
    });
  });

  describe('POST /profile/rate-card', () => {
    it('201 uploads rate card', async () => {
      profileSvc.uploadRateCardFile.mockResolvedValueOnce({
        rateCardUrl: '/uploads/rate-cards/card.pdf',
      });
      await request(app.getHttpServer())
        .post('/profile/rate-card')
        .attach('file', Buffer.from('pdf-content'), {
          filename: 'rate-card.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      expect(profileSvc.uploadRateCardFile).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ originalname: 'rate-card.pdf' }),
      );
    });
  });

  describe('DELETE /profile/rate-card', () => {
    it('200 deletes rate card', async () => {
      profileSvc.deleteRateCardFile.mockResolvedValueOnce({
        message: 'deleted',
      });
      await request(app.getHttpServer())
        .delete('/profile/rate-card')
        .expect(200);
      expect(profileSvc.deleteRateCardFile).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });

  describe('DELETE /profile', () => {
    it('200 deletes profile', async () => {
      profileSvc.deleteProfile.mockResolvedValueOnce({ message: 'deleted' });
      await request(app.getHttpServer()).delete('/profile').expect(200);
      expect(profileSvc.deleteProfile).toHaveBeenCalledWith(TEST_USER_ID);
    });
  });
});
