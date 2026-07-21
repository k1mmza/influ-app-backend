/**
 * Promote an existing user to ADMIN.
 *
 *   npx ts-node prisma/scripts/promote-admin.ts <email>
 *
 * ADMIN is deliberately not reachable through signup (see SELF_SELECTABLE_ROLES
 * in src/auth/dto/select-role.dto.ts), so this is the only supported way to
 * create one: the person registers normally, then is promoted out of band.
 *
 * Kept out of prisma/seed.ts on purpose — that script deletes users by email,
 * and admin provisioning must never sit next to destructive seed logic.
 *
 * Idempotent: re-running against an existing admin is a no-op.
 */
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    throw new Error(
      'Usage: npx ts-node prisma/scripts/promote-admin.ts <email>',
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(
      `No user with email "${email}". Register the account first, then re-run.`,
    );
  }
  if (user.isDeleted) {
    throw new Error(`User "${email}" is deleted — refusing to promote.`);
  }
  if (user.role === UserRole.ADMIN) {
    console.log(`✓ ${email} is already an ADMIN — nothing to do.`);
    return;
  }

  const previousRole = user.role;
  await prisma.user.update({
    where: { id: user.id },
    // isRoleSelected guards the signup role picker; set it so a promoted user
    // is never sent back through role selection.
    data: { role: UserRole.ADMIN, isRoleSelected: true },
  });

  console.log(`✓ Promoted ${email} to ADMIN (was ${previousRole}).`);
  console.log(
    '  Note: any BrandProfile/AgencyProfile/InfluencerProfile rows are left in place.',
  );
}

main()
  .catch((err) => {
    console.error(`✗ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
