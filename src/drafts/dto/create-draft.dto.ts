import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDraftDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkUrl?: string;

  // pdf | image | video | link — UI sets this based on upload vs paste-link choice
  @ApiPropertyOptional({ enum: ['pdf', 'image', 'video', 'link'] })
  @IsOptional()
  @IsString()
  @IsIn(['pdf', 'image', 'video', 'link'])
  contentType?: string;
}
