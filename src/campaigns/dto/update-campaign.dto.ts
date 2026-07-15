import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignRequirementDto } from './campaign-requirement.dto';

export class UpdateCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  objective?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  budget?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiPropertyOptional({ description: 'PUBLIC or PRIVATE (not enforced by validation — free string in the schema).' })
  @IsOptional()
  @IsString()
  visibility?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  keyMessage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  doAndDont?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliverables?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  applyDeadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  submissionDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  reviewDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientBrandId?: string;

  @ApiPropertyOptional({ type: () => CampaignRequirementDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CampaignRequirementDto)
  requirements?: CampaignRequirementDto[];
}
