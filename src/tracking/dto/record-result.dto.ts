import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordResultDto {
  @ApiProperty()
  @IsString()
  submittedContentId!: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  views?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  likes?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  comments?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  shares?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  engagementRate?: number;

  @ApiPropertyOptional({
    description:
      'Dedup discriminator for the (submittedContentId, recordedAt, snapshotPeriod) natural key. Schema comment says "DAILY, WEEKLY, etc." but only "DAILY" is currently written by any code path (YouTube sync) — free-form string, not enforced.',
    example: 'DAILY',
  })
  @IsOptional()
  @IsString()
  snapshotPeriod?: string;
}
