import {
  INestApplication,
  ValidationPipe,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

export const TEST_USER_ID = 'uid-test-1234';

/** Sets req.user and grants access — drop-in for JwtAuthGuard. */
export const AUTH_PASS = {
  canActivate: (ctx: any) => {
    ctx.switchToHttp().getRequest().user = {
      userId: TEST_USER_ID,
      email: 'test@example.com',
    };
    return true;
  },
};

/** Simulates missing/invalid token → 401. */
export const AUTH_FAIL = {
  canActivate: () => {
    throw new UnauthorizedException();
  },
};

/** Simulates wrong role → 403. */
export const ROLE_FAIL = {
  canActivate: () => {
    throw new ForbiddenException();
  },
};

/** Roles guard that always passes. */
export const ROLE_PASS = { canActivate: () => true };

/** Attaches ValidationPipe (matching production main.ts) and initializes the app. */
export async function initApp(compiled: any): Promise<INestApplication> {
  const app: INestApplication = compiled.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
