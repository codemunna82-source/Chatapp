import { Tenant } from '../src/modules/tenants/tenant.model';
import { User, type UserRole, type UserStatus } from '../src/modules/users/user.model';
import { hashPassword } from '../src/lib/password';
import type { Permission } from '../src/modules/users/permission';

export async function createTestTenant(name = 'Test Tenant') {
  return Tenant.create({ name, slug: name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now() });
}

export interface CreateTestUserOpts {
  tenantId: string;
  email: string;
  password?: string;
  role?: UserRole;
  permissions?: Permission[];
  status?: UserStatus;
  validFrom?: Date;
  validUntil?: Date;
}

export async function createTestUser(opts: CreateTestUserOpts) {
  const passwordHash = await hashPassword(opts.password ?? 'Password123!');
  const now = new Date();
  const oneYear = new Date(now);
  oneYear.setFullYear(oneYear.getFullYear() + 1);

  return User.create({
    tenantId: opts.tenantId,
    email: opts.email.toLowerCase(),
    passwordHash,
    role: opts.role ?? 'SUB_USER',
    permissions: opts.permissions ?? [],
    status: opts.status ?? 'ACTIVE',
    validFrom: opts.validFrom ?? now,
    validUntil: opts.validUntil ?? oneYear,
  });
}
