import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDraftDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  // pdf | image | video | link — UI sets this based on upload vs paste-link choice
  @IsOptional()
  @IsString()
  @IsIn(['pdf', 'image', 'video', 'link'])
  contentType?: string;
}
