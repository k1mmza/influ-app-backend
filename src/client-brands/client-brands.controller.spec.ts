import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ClientBrandsController } from './client-brands.controller';
import { ClientBrandsService } from './client-brands.service';
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

const svc = {
  getClientBrandsForUser: jest.fn(),
  createManagedBrand: jest.fn(),
};

async function buildApp(jwtMock: object, rolesMock: object) {
  const module = await Test.createTestingModule({
    controllers: [ClientBrandsController],
    providers: [{ provide: ClientBrandsService, useValue: svc }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtMock)
    .overrideGuard(RolesGuard)
    .useValue(rolesMock)
    .compile();
  return initApp(module);
}

describe('ClientBrandsController', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp(AUTH_PASS, ROLE_PASS);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  describe('GET /client-brands', () => {
    it('200 returns client brands for user, no search', async () => {
      svc.getClientBrandsForUser.mockResolvedValueOnce([
        { id: 'cb-1', brandName: 'Acme', brandEmail: null, brandWebsite: null, logoUrl: null, origin: 'AGENCY_MANAGED' },
      ]);
      const res = await request(app.getHttpServer())
        .get('/client-brands')
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(svc.getClientBrandsForUser).toHaveBeenCalledWith(TEST_USER_ID, undefined);
    });

    it('200 returns client brands filtered by search query param', async () => {
      svc.getClientBrandsForUser.mockResolvedValueOnce([]);
      await request(app.getHttpServer())
        .get('/client-brands?search=acme')
        .expect(200);
      expect(svc.getClientBrandsForUser).toHaveBeenCalledWith(TEST_USER_ID, 'acme');
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL, ROLE_PASS);
      await request(noAuthApp.getHttpServer()).get('/client-brands').expect(401);
      await noAuthApp.close();
    });

    it('403 when role is neither BRAND nor AGENCY', async () => {
      const noRoleApp = await buildApp(AUTH_PASS, ROLE_FAIL);
      await request(noRoleApp.getHttpServer()).get('/client-brands').expect(403);
      await noRoleApp.close();
    });
  });

  describe('POST /client-brands', () => {
    it('201 creates a managed brand with only required field', async () => {
      svc.createManagedBrand.mockResolvedValueOnce({
        id: 'cb-1',
        brandName: 'Acme',
        brandEmail: null,
        brandWebsite: null,
        logoUrl: null,
        origin: 'AGENCY_MANAGED',
      });
      const res = await request(app.getHttpServer())
        .post('/client-brands')
        .send({ brandName: 'Acme' })
        .expect(201);
      expect(res.body.brandName).toBe('Acme');
      expect(svc.createManagedBrand).toHaveBeenCalledWith(TEST_USER_ID, { brandName: 'Acme' });
    });

    it('201 creates a managed brand with optional brandEmail and logoUrl', async () => {
      svc.createManagedBrand.mockResolvedValueOnce({
        id: 'cb-2',
        brandName: 'Acme',
        brandEmail: 'a@b.com',
        brandWebsite: null,
        logoUrl: 'https://x/y.png',
        origin: 'AGENCY_MANAGED',
      });
      await request(app.getHttpServer())
        .post('/client-brands')
        .send({ brandName: 'Acme', brandEmail: 'a@b.com', logoUrl: 'https://x/y.png' })
        .expect(201);
      expect(svc.createManagedBrand).toHaveBeenCalledWith(TEST_USER_ID, {
        brandName: 'Acme',
        brandEmail: 'a@b.com',
        logoUrl: 'https://x/y.png',
      });
    });

    it('400 when brandName is missing', async () => {
      await request(app.getHttpServer())
        .post('/client-brands')
        .send({})
        .expect(400);
      expect(svc.createManagedBrand).not.toHaveBeenCalled();
    });

    it('400 when brandEmail is not a valid email', async () => {
      await request(app.getHttpServer())
        .post('/client-brands')
        .send({ brandName: 'Acme', brandEmail: 'not-an-email' })
        .expect(400);
      expect(svc.createManagedBrand).not.toHaveBeenCalled();
    });

    it('401 without token', async () => {
      const noAuthApp = await buildApp(AUTH_FAIL, ROLE_PASS);
      await request(noAuthApp.getHttpServer())
        .post('/client-brands')
        .send({ brandName: 'Acme' })
        .expect(401);
      await noAuthApp.close();
    });

    // Method-level @Roles(AGENCY) overrides the class-level BRAND/AGENCY default,
    // so a BRAND-role caller (who can GET) must be rejected here.
    it('403 when caller role is not AGENCY (method-level @Roles override)', async () => {
      const noRoleApp = await buildApp(AUTH_PASS, ROLE_FAIL);
      await request(noRoleApp.getHttpServer())
        .post('/client-brands')
        .send({ brandName: 'Acme' })
        .expect(403);
      expect(svc.createManagedBrand).not.toHaveBeenCalled();
      await noRoleApp.close();
    });
  });
});
