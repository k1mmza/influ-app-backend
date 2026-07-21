import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { UserRole } from '@prisma/client';

/**
 * Roles a user may assign to THEMSELVES at signup.
 *
 * Deliberately not `UserRole` — ADMIN is in the Prisma enum but must never be
 * self-assignable. `@IsEnum(UserRole)` would accept every value the enum ever
 * gains, so a plain `curl POST /auth/select-role {"role":"ADMIN"}` from any
 * account that hasn't picked a role yet would self-promote. Admins are
 * provisioned out of band via prisma/scripts/promote-admin.ts.
 *
 * Keep this list closed: new privileged roles must be added here explicitly,
 * never inherited from UserRole.
 */
export const SELF_SELECTABLE_ROLES: UserRole[] = [
  UserRole.BRAND,
  UserRole.AGENCY,
  UserRole.INFLUENCER,
];

export class SelectRoleDto {
  @ApiProperty({ enum: SELF_SELECTABLE_ROLES })
  @IsIn(SELF_SELECTABLE_ROLES)
  @IsNotEmpty()
  role: UserRole;
}
