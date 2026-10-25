import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes passwords using Argon2id', async () => {
    const password = 'correct-horse-battery-staple';

    const hash = await service.hash(password);

    expect(hash).not.toBe(password);
    expect(hash).toContain('$argon2id$');
  });

  it('verifies a correct password', async () => {
    const password = 'correct-horse-battery-staple';
    const hash = await service.hash(password);

    await expect(service.verify(hash, password)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('correct-password');

    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('fails safely for a malformed password hash', async () => {
    await expect(
      service.verify('not-an-argon2-hash', 'password'),
    ).resolves.toBe(false);
  });
});
