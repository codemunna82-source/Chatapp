import request from 'supertest';
import { createApp } from '../../app';
import { createTestTenant, createTestUser } from '../../../test/helpers';
import { signAccessToken } from '../../lib/jwt';
import { useMongoMemoryServer } from '../../../test/withMongo';
import { creditWallet, debitWallet } from './wallet.repository';

useMongoMemoryServer();
const app = createApp();

async function tokenFor(tenantId: string, role: 'MASTER_ADMIN' | 'SUB_USER' = 'MASTER_ADMIN') {
  const user = await createTestUser({ tenantId, email: `u-${Date.now()}-${Math.random()}@voxo.test`, role });
  return signAccessToken({ sub: String(user._id), tenantId, role });
}

describe('Wallet REST', () => {
  it('MASTER_ADMIN can read balance and the transaction ledger', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    await creditWallet(tenantId, 100, 'initial top-up');
    await debitWallet(tenantId, 30, 'message billing');
    const token = await tokenFor(tenantId);

    const wallet = await request(app).get('/api/wallet').set('Authorization', `Bearer ${token}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.data.balance).toBe(70);

    const txs = await request(app).get('/api/wallet/transactions').set('Authorization', `Bearer ${token}`);
    expect(txs.status).toBe(200);
    expect(txs.body.data).toHaveLength(2);
  });

  it('a SUB_USER cannot access the wallet', async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(String(tenant._id), 'SUB_USER');

    const res = await request(app).get('/api/wallet').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('tenant A cannot see tenant B\'s wallet balance', async () => {
    const tenantA = await createTestTenant('Tenant A');
    const tenantB = await createTestTenant('Tenant B');
    await creditWallet(String(tenantB._id), 500, 'B only');
    const tokenA = await tokenFor(String(tenantA._id));

    const res = await request(app).get('/api/wallet').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(0);
  });
});
