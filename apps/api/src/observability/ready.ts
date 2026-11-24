import Redis from 'ioredis';
import postgres from 'postgres';

export type Probe = {
  name: string;
  check: () => Promise<void>;
};

export type ProbeResult = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type ReadyReport = {
  status: 'ready' | 'not_ready';
  checks: ProbeResult[];
};

export async function checkReady(
  probes: readonly Probe[],
): Promise<ReadyReport> {
  const checks: ProbeResult[] = [];
  for (const probe of probes) {
    try {
      await probe.check();
      checks.push({ name: probe.name, ok: true });
    } catch (error) {
      checks.push({
        name: probe.name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    status: checks.every((item) => item.ok) ? 'ready' : 'not_ready',
    checks,
  };
}

export function postgresProbe(url: string): Probe {
  return {
    name: 'postgres',
    check: async () => {
      const sql = postgres(url, { max: 1, connect_timeout: 3 });
      try {
        await sql`select 1`;
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
  };
}

export function redisProbe(url: string): Probe {
  return {
    name: 'redis',
    check: async () => {
      const redis = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3000,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      redis.on('error', () => {});
      try {
        await redis.connect();
        const reply = await redis.ping();
        if (reply !== 'PONG')
          throw new Error(`unexpected ping reply: ${reply}`);
      } finally {
        try {
          redis.disconnect();
        } catch {
          // ignore close races after a failed connect
        }
      }
    },
  };
}

/** Hit MinIO's readiness path. Used only when S3_ENDPOINT is set. */
export function minioProbe(endpoint: string): Probe {
  return {
    name: 'minio',
    check: async () => {
      const url = new URL('/minio/health/ready', endpoint);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok)
        throw new Error(`minio ready returned ${response.status}`);
    },
  };
}

export function requiredUrlProbe(
  name: string,
  value: string | undefined,
): Probe {
  return {
    name,
    check: async () => {
      if (!value) throw new Error(`${name} URL is not configured`);
    },
  };
}
