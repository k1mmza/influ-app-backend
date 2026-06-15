# Influencer Discovery Platform — Backend

## Stack
- **Framework:** NestJS + TypeScript
- **ORM:** Prisma (PostgreSQL)
- **Queue:** BullMQ + Redis
- **Auth:** JWT + Google OAuth (Passport.js)
- **AI:** Anthropic Claude API
  - Fast tasks: `claude-haiku-4-5-20251001`
  - Complex tasks: `claude-sonnet-4-6`

## Project Structure
```
src/
├── auth/             # JWT + Google SSO, guards, strategies
├── conversations/    # Messaging between brands/agencies and influencers (placeholder)
├── dashboard/        # Role-based dashboard stats (INFLUENCER, BRAND, AGENCY)
├── influencers/      # Discovery, filtering, smart search, AI analysis, sync TTL
├── prisma/           # PrismaService wrapper
├── profile/          # Profile CRUD for all roles + completeness score
└── sync/             # Platform sync queue + adapters (YouTube, Instagram, TikTok)
```

## Roles
Three roles only: `INFLUENCER`, `BRAND`, `AGENCY`
- `BRAND` and `AGENCY` both use `AgencyProfile` shape for now
- `INFLUENCER` has `InfluencerProfile` with platform accounts, rate cards, etc.
- Brands are linked to campaigns via `ClientBrand` (not directly via `BrandProfile`)

## Prisma Schema — Key Models

### User
- `id`, `email`, `name`, `role` (UserRole enum), `plan`, `profileCompleteness`, `isDeleted` (soft delete), `isRoleSelected`
- Relations: `brandProfile`, `agencyProfile`, `influencerProfile`, `wallet`, `notifications`, `messages`

### InfluencerProfile
- `id`, `userId` (optional — external profiles have no user), `bio`, `country`, `availabilityStatus`
- JSONB fields (always stored **lowercase**): `categories`, `styleTags`, `keywords`, `hashtags`
- Scores: `performanceScore`, `qualityScore`, `audienceQualityScore`, `growthRate`, `responseRate`
- Sync: `syncStatus` (IDLE | SYNCING), `lastSyncedAt`, `nextRefreshAt`
- External: `isExternal`, `externalHandle`, `claimed`, `claimedByUserId`
- Relations: `platformAccounts`, `rateCards`, `pastCollaborations`, `applications`, `conversations`, `payments`

### PlatformAccount
- `platform` (always **lowercase**: youtube, instagram, tiktok, x, facebook, lemon8)
- `handle`, `displayName`, `avatarUrl`, `profileUrl`
- `followers`, `avgViews`, `engagementRate`, `growthRate`
- `spotlightVideoId`, `spotlightVideoTitle`, `spotlightThumbnailUrl`
- Relations: `audienceInsights`, `contentPreviews`

### Campaign
- `status`: DRAFT | ACTIVE | PUBLIC | PRIVATE | COMPLETED
- `clientBrandId` → `ClientBrand` → `AgencyProfile`
- Relations: `requirements`, `applications`, `conversations`, `payments`, `trackingResults`

### Conversation + Message
- `Conversation` links `Campaign` + `ClientBrand` + `InfluencerProfile`
- `Message` has `senderId` (User), `content`, `attachmentUrls` (Json), `isRead`

### Other models
- `Wallet`, `Notification`, `RateCard`, `AudienceInsight`, `ContentPreview`
- `CampaignApplication` (status: PENDING | ACCEPTED | REJECTED)
- `SubmittedContent`, `TrackingResult`, `Shortlist`, `Payment`
- `ProfileEvent` (type: VIEW | SEARCH | SAVE | CAMPAIGN) — used for TTL calculation
- `SmartPlanBrief` — AI-generated campaign briefs

## Conventions

### General
- Use `async/await`, never `.then()`
- No `console.log` unless actively debugging — remove before committing
- Avoid `any` type unless absolutely necessary
- All env values via `process.env` — never hardcode secrets or URLs

### Error Handling
Use NestJS built-in HTTP exceptions consistently:
```typescript
throw new NotFoundException('User not found');
throw new BadRequestException('Invalid input');
throw new ForbiddenException('Access denied');
throw new UnauthorizedException();
```

### JSONB Fields (categories, styleTags, keywords, hashtags)
- Always stored **lowercase** in DB
- Always lowercase before saving:
  ```typescript
  categories: aiData?.category ? [aiData.category.toLowerCase()] : []
  styleTags: tags?.map(t => t.toLowerCase()) ?? []
  ```
- Filter with `array_contains`, never `string_contains`:
  ```typescript
  where.categories = { array_contains: value.toLowerCase() }
  ```

### Platform Names
- Always stored and queried **lowercase**: `youtube`, `instagram`, `tiktok`, `x`, `facebook`, `lemon8`, `linkedin`
- Always `.toLowerCase()` before saving or filtering

### Query Params
- All filter params arrive as strings from HTTP query — always parse before use:
  ```typescript
  const parsed = parseFloat(minEngagementRate);
  if (!isNaN(parsed) && parsed > 0) { ... }
  ```
- Never trust raw query param types

### Prisma
- Always `include: { platformAccounts: true }` when querying `InfluencerProfile` for display
- Use `$transaction` for multi-step writes
- Soft delete via `isDeleted: true` on User — never hard delete users

### API Routes
- No version prefix — routes are `/influencers`, `/auth`, `/profile`, `/dashboard`, etc.
- Auth guard: `@UseGuards(JwtAuthGuard)` on protected routes
- User ID comes from JWT payload: `req.user.id`