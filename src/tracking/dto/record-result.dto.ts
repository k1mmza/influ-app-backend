import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordResultDto {
  @IsString()
  submittedContentId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  views?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  likes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  comments?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  shares?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  engagementRate?: number;

  @IsOptional()
  @IsString()
  snapshotPeriod?: string; // DAILY, WEEKLY, etc.
}
