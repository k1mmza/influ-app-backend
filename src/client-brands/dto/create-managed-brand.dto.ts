import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateManagedBrandDto {
  @IsString()
  @IsNotEmpty()
  brandName!: string;

  @IsOptional()
  @IsEmail()
  brandEmail?: string;

  // Assumption: logoUrl is a plain URL string (e.g. an already-uploaded asset
  // URL), not a file upload — matches how Campaign.coverImageUrl is stored.
  // TODO: swap to a real upload endpoint if brands need direct logo uploads.
  @IsOptional()
  @IsString()
  logoUrl?: string;
}
