import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserRole } from '@prisma/client';

export class SelectRoleDto {
  @IsEnum(UserRole)
  @IsNotEmpty()
  role: UserRole;
}
