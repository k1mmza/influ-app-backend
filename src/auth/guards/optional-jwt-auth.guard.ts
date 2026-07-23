import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard, but never rejects. If a valid Bearer token is present the
 * request gets `req.user` ({ userId, email }); if it's missing or invalid the
 * request still proceeds with `req.user === undefined`. Used on otherwise-public
 * routes that want to know *who* is asking (e.g. to let an owner view their own
 * PRIVATE profile) without forcing authentication.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    // Swallow "no/invalid token" — return the user when present, undefined otherwise.
    return user ?? undefined;
  }
}
