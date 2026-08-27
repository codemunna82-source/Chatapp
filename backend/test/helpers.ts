import { Tenant } from '../src/modules/tenants/tenant.model';
import { User, type UserRole, type UserStatus } from '../src/modules/users/user.model';
import { hashPassword } from '../src/lib/password';
import type { Permission } from '../src/modules/users/permission';
import { WhatsAppAccount } from '../src/modules/whatsapp/whatsappAccount.model';
import { WhatsAppPhoneNumber } from '../src/modules/whatsapp/whatsappPhoneNumber.model';
import { Contact } from '../src/modules/contacts/contact.model';
import { Conversation } from '../src/modules/conversations/conversation.model';

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

/** Creates a connected WABA + phone number + contact + conversation in one call — the common Phase 5 test fixture. */
export async function createTestChatFixture(tenantId: string, opts: { contactPhone?: string; withinWindow?: boolean } = {}) {
  const wabaAccount = await WhatsAppAccount.create({
    tenantId,
    wabaId: `test-waba-${Date.now()}-${Math.random()}`,
    accessTokenRef: 'mock:test-token',
    verifyToken: 'test-verify-token',
    status: 'CONNECTED',
  });
  const phoneNumber = await WhatsAppPhoneNumber.create({
    tenantId,
    whatsappAccountId: wabaAccount._id,
    phoneNumberId: `test-phone-${Date.now()}-${Math.random()}`,
    displayPhoneNumber: '+15550009999',
    status: 'CONNECTED',
  });
  const contact = await Contact.create({ tenantId, phone: opts.contactPhone ?? '+15550001234', name: 'Test Contact' });

  const now = new Date();
  const conversation = await Conversation.create({
    tenantId,
    contactId: contact._id,
    whatsappPhoneNumberId: phoneNumber._id,
    ...(opts.withinWindow !== false
      ? { lastCustomerMessageAt: now, conversationWindowExpiresAt: new Date(now.getTime() + 60 * 60 * 1000) }
      : {}),
  });

  return { wabaAccount, phoneNumber, contact, conversation };
}
