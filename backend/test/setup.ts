import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// Must be set before any module that imports src/config/env.ts is required
// by the test file itself — setupFilesAfterEnv runs first, so this is safe.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-do-not-use-in-prod';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_TTL ??= '15m';
process.env.JWT_REFRESH_TTL ??= '30d';
process.env.META_MOCK_MODE ??= 'true';
// Placeholder — actual connection below points mongoose at the in-memory
// instance directly; this only satisfies env.ts's non-empty-string check.
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/voxo-test-placeholder';

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
