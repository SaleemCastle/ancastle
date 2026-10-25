import 'server-only';
import { createHash } from 'node:crypto';
import type { RedisClientType } from 'redis';
import { z } from 'zod';
import { AuthUnavailableError } from './errors';

export const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{43}$/;
const sessionSchema = z
    .object({
        version: z.uuid(),
        accessToken: z.string().min(1).max(16384),
        refreshToken: z.string().min(1).max(16384),
        accessExpiresAt: z.number().int().positive(),
        expiresAt: z.number().int().positive(),
    })
    .strict();
export type StoredSession = z.infer<typeof sessionSchema>;

export interface SessionStore {
    read(id: string): Promise<StoredSession | null>;
    create(id: string, record: StoredSession): Promise<boolean>;
    replace(id: string, version: string, record: StoredSession): Promise<boolean>;
    take(id: string): Promise<StoredSession | null>;
    lock(id: string, owner: string): Promise<boolean>;
    unlock(id: string, owner: string): Promise<void>;
}

const compareReplace = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, record = pcall(cjson.decode, raw)
if not ok or record.version ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3], 'XX')
return 1
`;
const compareDelete = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class RedisSessionStore implements SessionStore {
    constructor(
        private readonly connection: () => Promise<RedisClientType>,
        private readonly prefix: string,
        private readonly now: () => number = Date.now,
    ) {}

    private key(id: string) {
        return this.prefix + createHash('sha256').update(id).digest('hex');
    }

    private async run<T>(command: (client: RedisClientType) => Promise<T>): Promise<T> {
        try {
            return await command(await this.connection());
        } catch {
            throw new AuthUnavailableError();
        }
    }

    private decode(raw: string | null): StoredSession | null {
        if (!raw) return null;
        try {
            const result = sessionSchema.safeParse(JSON.parse(raw));
            return result.success && result.data.expiresAt > this.now() ? result.data : null;
        } catch {
            return null;
        }
    }

    async read(id: string): Promise<StoredSession | null> {
        if (!SESSION_ID_PATTERN.test(id)) return null;
        const raw = await this.run((client) => client.get(this.key(id)));
        const record = this.decode(raw);
        if (raw && !record)
            await this.run((client) =>
                client.eval(compareDelete, { keys: [this.key(id)], arguments: [raw] }),
            );
        return record;
    }

    async create(id: string, record: StoredSession): Promise<boolean> {
        if (!SESSION_ID_PATTERN.test(id)) throw new AuthUnavailableError();
        const ttl = record.expiresAt - this.now();
        if (ttl <= 0 || !sessionSchema.safeParse(record).success) throw new AuthUnavailableError();
        return (
            (await this.run((client) =>
                client.set(this.key(id), JSON.stringify(record), { NX: true, PX: ttl }),
            )) === 'OK'
        );
    }

    async replace(id: string, version: string, record: StoredSession): Promise<boolean> {
        if (!SESSION_ID_PATTERN.test(id)) return false;
        const ttl = record.expiresAt - this.now();
        if (ttl <= 0 || !sessionSchema.safeParse(record).success) return false;
        return (
            Number(
                await this.run((client) =>
                    client.eval(compareReplace, {
                        keys: [this.key(id)],
                        arguments: [version, JSON.stringify(record), String(ttl)],
                    }),
                ),
            ) === 1
        );
    }

    async take(id: string): Promise<StoredSession | null> {
        if (!SESSION_ID_PATTERN.test(id)) return null;
        return this.decode(await this.run((client) => client.getDel(this.key(id))));
    }

    async lock(id: string, owner: string): Promise<boolean> {
        return (
            (await this.run((client) =>
                client.set(this.key(id) + ':lock', owner, { NX: true, PX: 15000 }),
            )) === 'OK'
        );
    }

    async unlock(id: string, owner: string): Promise<void> {
        await this.run((client) =>
            client.eval(compareDelete, { keys: [this.key(id) + ':lock'], arguments: [owner] }),
        );
    }
}
