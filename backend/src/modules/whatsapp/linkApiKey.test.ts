import { useMongoMemoryServer } from '../../../test/withMongo';
import { createTestTenant, createTestChatFixture } from '../../../test/helpers';
import { rotateLinkApiKey, revokeLinkApiKey, findPhoneNumberByLinkApiKey } from './linkApiKey';

useMongoMemoryServer();

describe('link API key', () => {
  it('resolves the number it was generated for, and only that number', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    const { phoneNumber } = await createTestChatFixture(tenantId);

    const issued = await rotateLinkApiKey(String(phoneNumber._id), tenantId);
    expect(issued).toBeTruthy();

    const resolved = await findPhoneNumberByLinkApiKey(issued!.key);
    expect(String(resolved?._id)).toBe(String(phoneNumber._id));

    expect(await findPhoneNumberByLinkApiKey('some-made-up-key')).toBeNull();
  });

  it('invalidates the previous key when rotated', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    const { phoneNumber } = await createTestChatFixture(tenantId);

    const first = await rotateLinkApiKey(String(phoneNumber._id), tenantId);
    const second = await rotateLinkApiKey(String(phoneNumber._id), tenantId);

    expect(await findPhoneNumberByLinkApiKey(first!.key)).toBeNull();
    const resolved = await findPhoneNumberByLinkApiKey(second!.key);
    expect(String(resolved?._id)).toBe(String(phoneNumber._id));
  });

  it('stops resolving once revoked', async () => {
    const tenant = await createTestTenant();
    const tenantId = String(tenant._id);
    const { phoneNumber } = await createTestChatFixture(tenantId);

    const issued = await rotateLinkApiKey(String(phoneNumber._id), tenantId);
    expect(await revokeLinkApiKey(String(phoneNumber._id), tenantId)).toBe(true);
    expect(await findPhoneNumberByLinkApiKey(issued!.key)).toBeNull();
  });

  it('never resolves a key against a different tenant\'s number', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const { phoneNumber } = await createTestChatFixture(String(tenantA._id));

    // rotateLinkApiKey is scoped by tenantId in its filter — a caller
    // presenting the wrong tenant for this number's id must not succeed.
    const result = await rotateLinkApiKey(String(phoneNumber._id), String(tenantB._id));
    expect(result).toBeNull();
  });
});
