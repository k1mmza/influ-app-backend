import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateManagedBrandDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  brandName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  brandEmail?: string;

  // Assumption: logoUrl is a plain URL string (e.g. an already-uploaded asset
  // URL), not a file upload — matches how Campaign.coverImageUrl is stored.
  // TODO: swap to a real upload endpoint if brands need direct logo uploads.
  @ApiPropertyOptional({ description: 'Plain URL string of an already-uploaded logo asset (not a file upload on this endpoint).' })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}
