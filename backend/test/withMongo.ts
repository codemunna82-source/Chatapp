import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * Opt-in per-test-file MongoDB bootstrap (mongodb-memory-server). Split out
 * from setup.ts so pure/offline test files (Meta mock gateway, webhook
 * signature verification, payload parsing) don't pay for — or depend on —
 * a mongod binary download that may not be available in every environment.
 * Call this once at the top of any test file that touches Mongoose models.
 */
export function useMongoMemoryServer(): void {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60_000);

  afterEach(async () => {
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod?.stop();
  });
}
