/**
 * 仅供服务层测试使用的内存 Prisma 替身：
 * 覆盖 Timeline / UndoEntry / Media / User 的真实调用路径与事务语义，
 * 事务按顺序执行（模拟 withTimelineLock 的串行性）。
 */
import type { TimelineDoc } from "@timeline/core";

export interface FakeTimelineRow {
  id: string;
  name: string;
  doc: TimelineDoc;
  revision: number;
  docHash: string;
  frozen: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeUndoRow {
  id: string;
  timelineId: string;
  userId: string;
  seq: number;
  label: string;
  inverse: unknown;
  baseHash: string;
  baseRevision: number;
  createdAt: Date;
}

export interface FakeMediaRow {
  id: string;
  name: string;
  kind: string;
  fps: string;
  duration: number;
  sampleRate: number | null;
  width: number | null;
  height: number | null;
  retired: boolean;
  createdAt: Date;
}

export interface FakeUserRow {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: "admin" | "editor";
  createdAt: Date;
}

export class FakePrisma {
  timeline: FakeTable<FakeTimelineRow>;
  undoEntry: UndoTable;
  media: MediaTable;
  user: UserTable;
  renderJob = new RenderTable();
  idempotentRequest = { findUnique: async () => null, create: async () => ({}) };

  constructor() {
    this.timeline = new FakeTable<FakeTimelineRow>("timeline");
    this.undoEntry = new UndoTable();
    this.media = new MediaTable();
    this.user = new UserTable();
  }

  $transaction = async (ops: Promise<unknown>[] | (() => Promise<unknown>)) => {
    if (typeof ops === "function") return ops();
    return Promise.all(ops);
  };
  $executeRaw = async () => 0;
  $executeRawUnsafe = async () => 0;
  $queryRaw = async () => [1];
  $on = () => undefined;
  $disconnect = async () => undefined;
}

class FakeTable<T extends { id: string }> {
  rows = new Map<string, T>();
  constructor(public name: string) {}
  async findUniqueOrThrow(args: { where: { id: string } }) {
    const r = this.rows.get(args.where.id);
    if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
    return structuredClone(r);
  }
  async findUnique(args: { where: { id: string } }) {
    const r = this.rows.get(args.where.id);
    return r ? structuredClone(r) : null;
  }
  async upsert(args: {
    where: { id: string };
    update: Partial<T>;
    create: T;
  }) {
    const existing = this.rows.get(args.where.id);
    const row = existing ? { ...existing, ...args.update, updatedAt: new Date() } : { ...args.create };
    this.rows.set(row.id, row as T);
    return structuredClone(row);
  }
  async update(args: { where: { id: string }; data: Partial<T> }) {
    const r = this.rows.get(args.where.id);
    if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
    Object.assign(r, args.data, { updatedAt: new Date() });
    return structuredClone(r);
  }
  async findMany(_args?: unknown) {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  async create(args: { data: T }) {
    this.rows.set(args.data.id, structuredClone(args.data));
    return structuredClone(args.data);
  }
}

class UndoTable extends FakeTable<FakeUndoRow> {
  constructor() {
    super("undo");
  }
  async create(args: { data: Omit<FakeUndoRow, "id" | "createdAt"> & { id?: string } }) {
    const provided = args.data as Partial<FakeUndoRow>;
    const row: FakeUndoRow = {
      timelineId: provided.timelineId!,
      userId: provided.userId!,
      seq: provided.seq!,
      label: provided.label!,
      inverse: provided.inverse!,
      baseHash: provided.baseHash!,
      baseRevision: provided.baseRevision!,
      id: provided.id ?? `undo-${this.rows.size + 1}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date()
    };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }
  async findMany(args: {
    where: { timelineId: string; userId: string };
    orderBy: { seq: "desc" };
    take: number;
  }) {
    return [...this.rows.values()]
      .filter((r) => r.timelineId === args.where.timelineId && r.userId === args.where.userId)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, args.take)
      .map((r) => structuredClone(r));
  }
  async findFirst(args: {
    where: { timelineId: string; userId: string };
    orderBy: { seq: "desc" };
    select: { seq: true };
  }) {
    const rows = [...this.rows.values()]
      .filter((r) => r.timelineId === args.where.timelineId && r.userId === args.where.userId)
      .sort((a, b) => b.seq - a.seq);
    return rows[0] ? { seq: rows[0].seq } : null;
  }
  async findFirstOrThrow(args: { where: { id: string; timelineId: string; userId: string } }) {
    const r = [...this.rows.values()].find(
      (x) => x.id === args.where.id && x.timelineId === args.where.timelineId && x.userId === args.where.userId
    );
    if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
    return structuredClone(r);
  }
  async delete(args: { where: { id: string } }) {
    const r = this.rows.get(args.where.id);
    this.rows.delete(args.where.id);
    return r ? structuredClone(r) : null;
  }
}

class MediaTable extends FakeTable<FakeMediaRow> {
  constructor() {
    super("media");
  }
  async findMany() {
    return [...this.rows.values()]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => structuredClone(r));
  }
}

class UserTable {
  rows = new Map<string, FakeUserRow>();
  async findUniqueOrThrow(args: { where: { id: string } }) {
    const r = this.rows.get(args.where.id);
    if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
    return structuredClone(r);
  }
  async findUnique(args: { where: { username: string } | { id: string } }) {
    const where = args.where as { username?: string; id?: string };
    const r = [...this.rows.values()].find(
      (x) => (where.username ? x.username === where.username : x.id === where.id)
    );
    return r ? structuredClone(r) : null;
  }
  async findFirst() {
    return this.rows.size ? structuredClone([...this.rows.values()][0]) : null;
  }
}


export interface FakeRenderRow {
  id: string; timelineId: string; userId: string; status: string; progress: number;
  snapshot: unknown; exportStart: number; exportEnd: number; fps: string;
  resultUrl: string | null; message: string | null;
  createdAt: Date; updatedAt: Date; startedAt: Date | null; finishedAt: Date | null;
}

class RenderTable {
  rows = new Map<string, FakeRenderRow>();
  async create(args: { data: Partial<FakeRenderRow> & { timelineId: string; userId: string } }) {
    const id = `render-${this.rows.size + 1}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const row: FakeRenderRow = {
      id,
      status: "queued",
      progress: 0,
      snapshot: null,
      exportStart: 0,
      exportEnd: 0,
      fps: "30/1",
      resultUrl: null,
      message: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      ...args.data
    };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }
  async findUniqueOrThrow(args: { where: { id: string } }) {
    const r = this.rows.get(args.where.id);
    if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
    return structuredClone(r);
  }
  async findUnique(args: { where: { id: string } }) {
    const r = this.rows.get(args.where.id);
    return r ? structuredClone(r) : null;
  }
  async update(args: { where: { id: string }; data: Partial<FakeRenderRow> }) {
    const r = this.rows.get(args.where.id)!;
    Object.assign(r, args.data);
    return structuredClone(r);
  }
  async findMany(args?: { where?: { timelineId?: string }; take?: number }) {
    let rows = [...this.rows.values()];
    if (args?.where?.timelineId) rows = rows.filter((r) => r.timelineId === args.where!.timelineId);
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows.slice(0, args?.take ?? rows.length).map((r) => structuredClone(r));
  }
}
