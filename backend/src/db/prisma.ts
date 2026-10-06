import { PrismaClient } from "@prisma/client";

const realPrisma = new PrismaClient({
  log: [
    { level: "warn", emit: "event" },
    { level: "error", emit: "event" }
  ]
});

function resolvePrisma(): unknown {
  return (globalThis as Record<string, unknown>).__TEST_PRISMA__ ?? realPrisma;
}

export const prisma = new Proxy({} as InstanceType<typeof PrismaClient>, {
  get(_t, prop) {
    const target = resolvePrisma() as Record<string | symbol, unknown>;
    const v = target[prop];
    return typeof v === "function" ? v.bind(target) : v;
  }
});

realPrisma.$on("warn", (e) => {
  // 通过标准日志库输出，禁止裸 console
  import("../logger.js").then(({ logger }) => logger.warn(e));
});
realPrisma.$on("error", (e) => {
  import("../logger.js").then(({ logger }) => logger.error(e));
});


// 测试注入点：服务层测试用内存替身替换真实客户端（生产环境永不调用）
export function __setPrismaForTest(client: unknown): void {
  (globalThis as Record<string, unknown>).__TEST_PRISMA__ = client;
}
