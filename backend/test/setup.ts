// Env defaults only — kept free of any network/DB dependency so every test
// file, including ones that never touch MongoDB (Meta mock gateway,
// webhook signature/payload parsing), can run offline. Test files that DO
// need a database import `useMongoMemoryServer()` from ./withMongo
// themselves — see that file for why this is split out.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-do-not-use-in-prod';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_TTL ??= '15m';
process.env.JWT_REFRESH_TTL ??= '30d';
process.env.META_MOCK_MODE ??= 'true';
process.env.META_APP_SECRET ??= 'test-meta-app-secret';
process.env.META_VERIFY_TOKEN ??= 'test-verify-token';
// The customer-facing web chat needs a public origin to build its link
// from; without one, issuing a link is a configuration error rather than a
// test failure.
process.env.GUEST_LINK_BASE_URL ??= 'https://chat.example.com';
// Placeholder — real DB-backed tests point mongoose at an in-memory
// instance via withMongo.ts; this only satisfies env.ts's non-empty check.
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/voxo-test-placeholder';
