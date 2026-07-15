import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserRole } from '@prisma/client';

export class SelectRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  @IsNotEmpty()
  role: UserRole;
}
