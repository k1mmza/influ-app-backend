# influApp — Backend

NestJS 11 + Prisma + Supabase PostgreSQL — runs on **port 3001**

## Getting Started

```bash
npm install
npm run start:dev        # watch mode → http://localhost:3001
npm run build            # compile TypeScript
npm run lint             # ESLint + Prettier fix
npm test                 # Jest unit tests
npm run test:e2e         # E2E tests
npx prisma migrate dev   # apply DB migrations
npx prisma studio        # browse DB in browser
```

## Environment Variables

Create a `.env` file in this directory:

```env
# ── Supabase / PostgreSQL ─────────────────────────────────────────────────────
# Transaction-mode pooler (used at runtime, IPv4-only)
DATABASE_URL="postgresql://postgres.****:****@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Session-mode pooler (used by Prisma migrate)
DIRECT_URL="postgresql://postgres.****:****@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"

# ── App ───────────────────────────────────────────────────────────────────────
PORT=3001
JWT_SECRET="****"
FRONTEND_URL="http://localhost:3000"

# ── Google OAuth ──────────────────────────────────────────────────────────────
# Get from console.cloud.google.com → APIs & Services → Credentials
GOOGLE_CLIENT_ID="****.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-****"
GOOGLE_CALLBACK_URL="http://localhost:3001/auth/google/callback"

# ── YouTube Data API v3 ───────────────────────────────────────────────────────
# Get from console.cloud.google.com → APIs & Services → Credentials
YOUTUBE_API_KEY="****"

# ── Anthropic API ─────────────────────────────────────────────────────────────
# Get from console.anthropic.com
ANTHROPIC_API_KEY="sk-ant-****"

# ── Apify (TikTok & Instagram scraping) ──────────────────────────────────────
# Get from apify.com → Settings → Integrations
APIFY_API_TOKEN="apify_api_****"
```

> **Never commit the real `.env` file.** It is listed in `.gitignore`.