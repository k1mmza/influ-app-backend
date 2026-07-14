import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Shared shape for TrackingShareLink, CampaignShareLink, and
 * CampaignShortlistShareLink — structurally identical in schema.prisma.
 *
 * A link is usable only while revokedAt IS NULL AND (expiresAt IS NULL OR
 * expiresAt > now()). `token` (not `campaignId`) is the public lookup key
 * used in the share URL.
 */
export class ShareLinkResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Crypto-random URL key (base64url) — the public lookup key for the share link. Never campaignId.' })
  token: string;

  @ApiProperty()
  campaignId: string;

  @ApiProperty()
  createdById: string;

  @ApiPropertyOptional({ description: 'Revocation timestamp. Null means active.', nullable: true })
  revokedAt: Date | null;

  @ApiPropertyOptional({ description: 'Finite expiry (default 90d from creation). Null means no expiry.', nullable: true })
  expiresAt: Date | null;

  @ApiPropertyOptional({ description: 'Best-effort last public open. Null if never viewed.', nullable: true })
  lastViewedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}
