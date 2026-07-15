import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Body for POST /auth/refresh and POST /auth/logout. The raw refresh token is
 * the only credential — validated against its stored SHA-256 hash server-side.
 */
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}
