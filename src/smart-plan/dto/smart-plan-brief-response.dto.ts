import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SmartPlanBriefResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ description: 'Null when the brief predates a campaign (standalone workspace brief).', nullable: true })
  campaignId: string | null;

  @ApiProperty({ description: 'Id of the user who created the brief.' })
  createdBy: string;

  @ApiPropertyOptional({ nullable: true })
  strategy: string | null;

  @ApiPropertyOptional({ nullable: true })
  concept: string | null;

  @ApiPropertyOptional({ nullable: true })
  briefBody: string | null;

  @ApiPropertyOptional({ description: 'Legacy field, kept for backward compat.', nullable: true })
  generatedBrief: string | null;

  @ApiPropertyOptional({
    description: 'Schema comment says "AI | MANUAL" but only "AI" is ever written by current code — free-form string, not enforced.',
    example: 'AI',
    nullable: true,
  })
  inputMode: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
