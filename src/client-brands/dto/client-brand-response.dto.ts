import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Shape actually returned by GET/POST /client-brands (CLIENT_BRAND_SELECT in
 * client-brands.service.ts). Note: the underlying ClientBrand model also has
 * agencyId/brandProfileId (both nullable, mutually informative via `origin`:
 * SELF_REGISTERED brands are linked via brandProfileId, AGENCY_MANAGED brands
 * via agencyId with brandProfileId null) — those two FKs are used internally
 * for ownership scoping but are not part of this response projection.
 */
export class ClientBrandResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  brandName: string;

  @ApiPropertyOptional({ nullable: true })
  brandEmail: string | null;

  @ApiPropertyOptional({ nullable: true })
  brandWebsite: string | null;

  @ApiPropertyOptional({ nullable: true })
  logoUrl: string | null;

  @ApiProperty({
    enum: ['SELF_REGISTERED', 'AGENCY_MANAGED'],
    description: 'SELF_REGISTERED: brand owns its own account (linked via brandProfileId). AGENCY_MANAGED: created inline by an agency, no login (linked via agencyId, brandProfileId null).',
  })
  origin: string;
}
