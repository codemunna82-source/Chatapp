/* eslint-disable no-console */
/**
 * Bootstraps the very first Tenant + MASTER_ADMIN user so the platform can
 * be logged into at all, plus (outside production) a small set of demo
 * WhatsApp/chat data so the Android app and dashboard have something to
 * render during development. Safe to re-run: it's a no-op if the seed admin
 * email already exists.
 *
 * Usage: npm run seed   (reads SEED_* vars from .env)
 */
import { connectMongo, disconnectMongo } from '../lib/mongoose';
import { env } from '../config/env';
import { Tenant } from '../modules/tenants/tenant.model';
import { User } from '../modules/users/user.model';
import { hashPassword } from '../lib/password';
import { createWabaAccount, createPhoneNumber } from '../modules/whatsapp/whatsapp.repository';
import { createContact } from '../modules/contacts/contact.repository';
import { findOrCreateConversation, recordInboundActivity, recordOutboundActivity } from '../modules/conversations/conversation.repository';
import { createMessage } from '../modules/messages/message.repository';
import { upsertTemplate } from '../modules/templates/messageTemplate.repository';
import { createSubscription } from '../modules/subscriptions/subscription.repository';
import { creditWallet } from '../modules/wallet/wallet.repository';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function seedDemoWorkspaceData(tenantId: string): Promise<void> {
  // Demo WhatsApp connection — clearly fake identifiers (never real Meta
  // credentials), so this must never run against a production database.
  const wabaAccount = await createWabaAccount({
    tenantId,
    wabaId: 'DEMO-WABA-000001',
    businessName: 'VOXO Demo Business',
    accessTokenRef: 'mock:demo-access-token', // pointer only — see whatsappAccount.model.ts
    verifyToken: env.META_VERIFY_TOKEN || 'demo-verify-token',
    status: 'CONNECTED',
  });
  wabaAccount.connectedAt = new Date();
  await wabaAccount.save();

  const phoneNumber = await createPhoneNumber({
    tenantId,
    whatsappAccountId: String(wabaAccount._id),
    phoneNumberId: 'DEMO-PHONE-000001',
    displayPhoneNumber: '+1 555 000 1111',
    qualityRating: 'GREEN',
  });

  const contactA = await createContact({ tenantId, phone: '+15550002222', name: 'Alex Rivera' });
  await createContact({ tenantId, phone: '+15550003333', name: 'Jordan Lee' });

  const conversation = await findOrCreateConversation(tenantId, String(contactA._id), String(phoneNumber._id));

  const inbound = await createMessage({
    tenantId,
    conversationId: String(conversation._id),
    recipientPhone: contactA.phone,
    direction: 'IN',
    type: 'text',
    text: 'Hi! Is my order #4821 ready for pickup?',
    metaMessageId: 'wamid.DEMO_INBOUND_0001',
    status: 'READ',
  });
  await recordInboundActivity(String(conversation._id), tenantId, inbound.text ?? '', inbound.get('createdAt'));

  const outbound = await createMessage({
    tenantId,
    conversationId: String(conversation._id),
    recipientPhone: contactA.phone,
    direction: 'OUT',
    type: 'text',
    text: 'Yes! Order #4821 is ready — you can pick it up anytime before 6pm today.',
    metaMessageId: 'wamid.DEMO_OUTBOUND_0001',
    status: 'DELIVERED',
  });
  await recordOutboundActivity(String(conversation._id), tenantId, outbound.text ?? '', outbound.get('createdAt'));

  await upsertTemplate({
    tenantId,
    name: 'order_ready_for_pickup',
    language: 'en_US',
    category: 'UTILITY',
    status: 'APPROVED',
    metaTemplateId: 'DEMO-TEMPLATE-0001',
    components: [
      { type: 'BODY', text: 'Your order {{1}} is ready for pickup at {{2}}.' },
      { type: 'FOOTER', text: 'Thank you for your business.' },
    ],
  });

  const oneYear = new Date();
  oneYear.setFullYear(oneYear.getFullYear() + 1);
  await createSubscription({ tenantId, plan: 'PRO', validFrom: new Date(), validUntil: oneYear, autoRenew: true });

  await creditWallet(tenantId, 100, 'Initial demo credit');
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

  if (env.NODE_ENV === 'production') {
    console.log('  NODE_ENV=production — skipping demo WhatsApp/chat data.');
    return;
  }

  await seedDemoWorkspaceData(String(tenant._id));
  console.log('  Demo data: WhatsApp account, 2 contacts, 1 conversation with 2 messages,');
  console.log('             1 approved template, a PRO subscription, and a $100 wallet credit.');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
