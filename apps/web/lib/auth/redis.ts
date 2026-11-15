import 'server-only';
import { createClient, type RedisClientType } from 'redis';
import { authConfig } from './config';
import { AuthUnavailableError } from './errors';

let client: RedisClientType | undefined;
let connecting: Promise<RedisClientType> | undefined;

export async function closeSessionRedis(): Promise<void> {
    if (connecting) await connecting.catch(() => undefined);
    const active = client;
    client = undefined;
    if (active?.isOpen) await active.close();
}

if (process.env.ANCASTLE_E2E_EXTERNAL_SERVERS === '1') {
    process.on('message', (message: { type?: string } | null) => {
        if (message?.type === 'shutdown') void closeSessionRedis();
    });
}

export async function sessionRedis(): Promise<RedisClientType> {
    if (client?.isReady) return client;
    if (connecting) return connecting;
    const candidate = createClient({
        url: authConfig().redisUrl,
        disableOfflineQueue: true,
        socket: { connectTimeout: 5000, reconnectStrategy: false },
    });
    // Command failures are converted to safe errors; connection events carry no logs.
    candidate.on('error', () => {});
    connecting = candidate
        .connect()
        .then(() => {
            client = candidate;
            return candidate;
        })
        .catch(() => {
            throw new AuthUnavailableError();
        })
        .finally(() => {
            connecting = undefined;
        });
    return connecting;
}
