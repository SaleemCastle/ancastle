import 'server-only';
import { createClient, type RedisClientType } from 'redis';
import { authConfig } from './config';
import { AuthUnavailableError } from './errors';

let client: RedisClientType | undefined;
let connecting: Promise<RedisClientType> | undefined;

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
