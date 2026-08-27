/* eslint-disable no-console */
/**
 * Bootstraps the very first Tenant + MASTER_ADMIN user so the platform can
 * be logged into at all. Safe to re-run: it's a no-op if the seed admin
 * email already exists.
 *
 * Usage: npm run seed   (reads SEED_* vars from .env)
 */
import { connectMongo, disconnectMongo } from '../lib/mongoose';
import { env } from '../config/env';
import { Tenant } from '../modules/tenants/tenant.model';
import { User } from '../modules/users/user.model';
import { hashPassword } from '../lib/password';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function seed(): Promise<void> {
  await connectMongo();

  const existing = await User.findOne({ email: env.SEED_MASTER_ADMIN_EMAIL.toLowerCase() });
  if (existing) {
    console.log(`Seed skipped — ${env.SEED_MASTER_ADMIN_EMAIL} already exists.`);
    return;
  }

  const tenant = await Tenant.create({
    name: env.SEED_TENANT_NAME,
    slug: slugify(env.SEED_TENANT_NAME),
    status: 'ACTIVE',
  });

  const passwordHash = await hashPassword(env.SEED_MASTER_ADMIN_PASSWORD);
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  const admin = await User.create({
    tenantId: tenant._id,
    email: env.SEED_MASTER_ADMIN_EMAIL.toLowerCase(),
    passwordHash,
    role: 'MASTER_ADMIN',
    permissions: [],
    status: 'ACTIVE',
    validFrom: new Date(),
    validUntil: oneYearFromNow,
    displayName: 'Master Admin',
  });

  tenant.masterAdminId = admin._id;
  await tenant.save();

  console.log('Seed complete:');
  console.log(`  Tenant: ${tenant.name} (${tenant._id})`);
  console.log(`  Master Admin: ${admin.email} / ${env.SEED_MASTER_ADMIN_PASSWORD}`);
  console.log('  ⚠️  Change this password immediately after first login.');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
