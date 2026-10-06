/**
 * 每条时间线一把异步互斥锁：同一时间线的“读-校验-写-记撤销”必须串行，
 * 从服务端杜绝“两个并发拖动同时读到 revision=N 然后互相覆盖”。
 * 跨实例部署时应替换为 Postgres 咨询锁/Redis 锁；单实例下本锁足够。
 */
const locks = new Map<string, Promise<unknown>>();

export async function withTimelineLock<T>(timelineId: string, fn: () => Promise<T>): Promise<T> {
  while (locks.has(timelineId)) {
    await locks.get(timelineId)?.catch(() => undefined);
  }
  let release: () => void = () => undefined;
  const ticket = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(timelineId, ticket);
  try {
    return await fn();
  } finally {
    locks.delete(timelineId);
    release();
  }
}
