/* eslint-disable no-console */
/**
 * Read and repair sign-in accounts from a shell on the server.
 *
 * Exists because "invalid phone number or password" is, correctly, the
 * same answer whether the account is missing or the password is wrong —
 * the login endpoint must not tell an attacker which — and that leaves
 * whoever is locked out with no way to tell those two apart either.
 *
 * Deliberately NOT the seed script. `seed` looks the admin up by
 * SEED_MASTER_ADMIN_EMAIL and creates a whole tenant when it does not find
 * one, so running it after that variable has changed silently produces a
 * SECOND workspace — with the WhatsApp number and every conversation left
 * behind in the first. Nothing here ever creates a tenant.
 *
 *   node dist/scripts/adminAccount.js list
 *   node dist/scripts/adminAccount.js numbers
 *   node dist/scripts/adminAccount.js set-password <identifier> <password>
 *   node dist/scripts/adminAccount.js set-phone    <identifier> <phone>
 *
 * <identifier> is the account's email or its phone number.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { User } from '../modules/users/user.model';
import { WhatsAppPhoneNumber } from '../modules/whatsapp/whatsappPhoneNumber.model';
import { hashPassword } from '../lib/password';
import { normalizePhone, phoneVariants } from '../lib/phone';

async function findByIdentifier(identifier: string) {
  const asPhone = normalizePhone(identifier);
  if (asPhone) return User.findOne({ phone: { $in: phoneVariants(asPhone) } });
  return User.findOne({ email: identifier.trim().toLowerCase() });
}

async function list(): Promise<void> {
  const users = await User.find().select('email phone role status tenantId validUntil').lean();
  if (users.length === 0) {
    console.log('\nNo accounts exist at all. Nothing can sign in.');
    console.log('Create the first one with:  node dist/scripts/seed.js');
    console.log('(set SEED_MASTER_ADMIN_EMAIL / _PHONE / _PASSWORD first)\n');
    return;
  }

  console.log(`\n${users.length} account(s):\n`);
  for (const u of users) {
    const expired = new Date(u.validUntil).getTime() < Date.now();
    console.log(`  ${u.role === 'MASTER_ADMIN' ? 'ADMIN ' : 'member'}  ${u.phone ?? '(no phone)'}`);
    console.log(`          email    ${u.email}`);
    console.log(`          status   ${u.status}${expired ? ' · ACCESS EXPIRED — this blocks sign-in' : ''}`);
    console.log(`          tenant   ${String(u.tenantId)}\n`);
  }
  console.log('Sign in with the phone above, or the email if there is no phone.\n');
}

/**
 * The WhatsApp numbers this workspace actually holds.
 *
 * Worth its own command because the id is what an inbound webhook is
 * routed by, and a number that looks right in the UI can still be a
 * leftover demo row — those are created with a phoneNumberId of
 * "test-phone-…", which Meta will never send. A real one is all digits.
 */
async function numbers(): Promise<void> {
  const rows = await WhatsAppPhoneNumber.find().select('phoneNumberId displayPhoneNumber status tenantId').lean();
  if (rows.length === 0) {
    console.log('\nNo WhatsApp numbers. Add one from the admin screen.\n');
    return;
  }

  console.log(`\n${rows.length} number(s):\n`);
  for (const n of rows) {
    const fake = !/^\d+$/.test(n.phoneNumberId);
    console.log(`  ${n.displayPhoneNumber}   ${n.status}`);
    console.log(`          phone_number_id  ${n.phoneNumberId}${fake ? '   ← NOT A REAL META ID (demo row)' : ''}`);
    console.log(`          tenant           ${String(n.tenantId)}\n`);
  }
  console.log('An inbound webhook is matched on phone_number_id. If the id above does');
  console.log('not match the one in WhatsApp Manager, every message is dropped.\n');
}

async function setPassword(identifier: string, password: string): Promise<void> {
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  const user = await findByIdentifier(identifier);
  if (!user) throw new Error(`No account matches "${identifier}". Run "list" to see what exists.`);

  user.passwordHash = await hashPassword(password);
  // An expired access window refuses the login with its own message, so a
  // password reset that left it in the past would look like it had not
  // worked at all.
  if (user.validUntil.getTime() < Date.now()) {
    const oneYear = new Date();
    oneYear.setFullYear(oneYear.getFullYear() + 1);
    user.validUntil = oneYear;
    console.log('Access window had expired — extended by a year.');
  }
  user.status = 'ACTIVE';
  await user.save();
  console.log(`\nPassword set for ${user.phone ?? user.email}. Sign in with it now.\n`);
}

async function setPhone(identifier: string, phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error(`"${phone}" is not a valid number. Include the country code, e.g. +919876543210`);

  const user = await findByIdentifier(identifier);
  if (!user) throw new Error(`No account matches "${identifier}". Run "list" to see what exists.`);

  const holder = await User.findOne({ phone: { $in: phoneVariants(normalized) } });
  if (holder && String(holder._id) !== String(user._id)) {
    throw new Error(`${normalized} already signs in as ${holder.email}.`);
  }

  user.phone = normalized;
  await user.save();
  console.log(`\n${user.email} now signs in with ${normalized}.\n`);
}

async function main(): Promise<void> {
  const [command, a, b] = process.argv.slice(2);
  await mongoose.connect(env.MONGODB_URI);
  try {
    if (command === 'list') await list();
    else if (command === 'numbers') await numbers();
    else if (command === 'set-password' && a && b) await setPassword(a, b);
    else if (command === 'set-phone' && a && b) await setPhone(a, b);
    else {
      console.log('\n  node dist/scripts/adminAccount.js list');
      console.log('  node dist/scripts/adminAccount.js numbers');
      console.log('  node dist/scripts/adminAccount.js set-password <email-or-phone> <new-password>');
      console.log('  node dist/scripts/adminAccount.js set-phone    <email-or-phone> <+919876543210>\n');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
