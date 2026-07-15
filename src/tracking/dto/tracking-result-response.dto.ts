import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrackingResultResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  campaignId: string;

  @ApiProperty()
  influencerId: string;

  @ApiProperty()
  submittedContentId: string;

  @ApiPropertyOptional({
    description:
      'Dedup discriminator for the (submittedContentId, recordedAt, snapshotPeriod) natural key. Only "DAILY" is currently written by any code path, despite the schema comment mentioning "WEEKLY, etc." — free-form string, not enforced.',
    example: 'DAILY',
    nullable: true,
  })
  snapshotPeriod: string | null;

  @ApiProperty()
  views: number;

  @ApiProperty()
  likes: number;

  @ApiProperty()
  comments: number;

  @ApiProperty()
  shares: number;

  @ApiProperty()
  engagementRate: number;

  @ApiProperty()
  recordedAt: Date;
}
