import { mockMetaGateway } from './mockMetaGateway';

const creds = { accessToken: 'unused-in-mock', phoneNumberId: 'PHONE_NUMBER_ID' };

describe('mockMetaGateway', () => {
  it('sendText returns a distinct fake message id per call', async () => {
    const a = await mockMetaGateway.sendText(creds, { to: '+15550000001', text: 'hi' });
    const b = await mockMetaGateway.sendText(creds, { to: '+15550000001', text: 'hi again' });
    expect(a.metaMessageId).toMatch(/^mock-wamid-/);
    expect(b.metaMessageId).toMatch(/^mock-wamid-/);
    expect(a.metaMessageId).not.toBe(b.metaMessageId);
  });

  it('sendTemplate and sendMedia also return fake message ids', async () => {
    const template = await mockMetaGateway.sendTemplate(creds, {
      to: '+15550000001',
      templateName: 'order_ready_for_pickup',
      languageCode: 'en_US',
    });
    expect(template.metaMessageId).toMatch(/^mock-wamid-/);

    const media = await mockMetaGateway.sendMedia(creds, {
      to: '+15550000001',
      mediaType: 'image',
      link: 'https://example.com/photo.jpg',
    });
    expect(media.metaMessageId).toMatch(/^mock-wamid-/);
  });

  it('markAsRead resolves without throwing', async () => {
    await expect(mockMetaGateway.markAsRead(creds, 'mock-wamid-abc')).resolves.toBeUndefined();
  });

  it('uploadMedia returns a fake media id, retrieveMedia round-trips it', async () => {
    const uploaded = await mockMetaGateway.uploadMedia(creds, {
      buffer: Buffer.from('fake-bytes'),
      mimeType: 'image/png',
    });
    expect(uploaded.metaMediaId).toMatch(/^mock-media-/);

    const retrieved = await mockMetaGateway.retrieveMedia(creds, uploaded.metaMediaId);
    expect(retrieved.metaMediaId).toBe(uploaded.metaMediaId);
    expect(retrieved.url).toContain(uploaded.metaMediaId);
  });

  it('downloadMediaBinary returns a non-empty buffer', async () => {
    const buf = await mockMetaGateway.downloadMediaBinary(creds, 'https://mock-meta.local/media/x');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('listTemplates returns only approved, well-formed templates', async () => {
    const templates = await mockMetaGateway.listTemplates({ accessToken: 'unused', wabaId: 'WABA' });
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.status).toBe('APPROVED');
      expect(['MARKETING', 'UTILITY', 'AUTHENTICATION']).toContain(t.category);
      expect(t.name).toEqual(expect.any(String));
      expect(t.language).toEqual(expect.any(String));
    }
  });
});
