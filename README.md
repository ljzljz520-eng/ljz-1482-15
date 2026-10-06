# 云溪多轨时间线编排工作台（Multi-Track Timeline Studio）

面向视频剪辑协作场景的全栈实现：React 前端拖动片段与关键点，Fastify 后端校验并写入 PostgreSQL，渲染任务使用**冻结的时间线版本**。时间内部采用**统一整数时间基 + 有理数帧率**，杜绝浮点秒累加误差。

## 🧠 核心设计：精确时间模型

- **统一时间基**：所有位置、时长、入出点、转场重叠、音频偏移、标记、导出范围一律使用**整数 tick**，`TICKS_PER_SECOND = 240_000`。
  该值可被 23.976 / 24 / 25 / 29.97 / 30 / 48 / 50 / 59.94 / 60 fps 的每帧 tick 数整除，也是 48kHz 音频每采样 tick 数（5）的整数倍——帧 ⇄ tick ⇄ 采样全部精确整数互换。
- **有理数帧率**：29.97fps 表达为 `30000/1001`（`Rational`，bigint 实现），不是 `29.969999…`；SMPTE 29.97/59.94 时间码使用整数丢帧算法。浮点只允许出现在最终 UI 显示。
- **共享内核** `@timeline/core`（前后端同一套纯函数）：校验、可序列化/可逆的操作（Op）、删除策略规划、并发重基线、文档哈希。

## 🛠 技术栈

- **Frontend**: React 18 + TypeScript + Vite + Tailwind + Zustand + Web Worker + Zod（Nginx 反代）
- **Backend**: Node 20 + Fastify + Prisma + JWT + Zod，pino 结构化日志
- **Database**: PostgreSQL 16（含**触发器级**悬空引用/整数 tick/转场/关键点约束）
- **Monorepo**: npm workspaces（`packages/core` 同时服务前后端）

## 🚀 启动指南（一键）

1. 确保 Docker Desktop（或 Docker Engine + Compose）已启动。
2. 在仓库根目录执行：
   ```bash
   docker compose up --build
   ```
3. 等待数据库迁移、触发器安装与 seed 完成（后端日志可见 `[entrypoint]` 与 `[seed]`）。
4. 访问：
   - 前端：<http://localhost:3000>
   - 后端健康检查：<http://localhost:3001/health>

## 🔗 服务地址

| 服务 | 地址 |
| --- | --- |
| Frontend | http://localhost:3000 |
| Backend | http://localhost:3001（容器内为 `http://backend:3001`） |
| PostgreSQL | localhost:5432，`timeline / timeline_pwd`，库 `timeline_studio` |

## 🧪 测试账号

- 管理员：`admin / 123456`（可在素材库**退役素材**，用于验收）
- 协作剪辑师：`editor / 123456`

## 🧭 功能与验收对照

| 需求 | 实现位置 |
| --- | --- |
| 多轨编排（视频/音频/字幕轨、拖动片段/关键点/标记） | `frontend/src/timeline/*` |
| 后端校验操作并写数据库 | `backend/src/services/timelineService.ts`（OCC + 全量校验 + 事务） |
| 渲染使用冻结时间线版本 | `renderService.ts`：创建任务即固化快照 + 同源导出范围，后续编辑不影响任务 |
| 明确时间基 + 有理数/整数 tick，禁浮点累加 | `packages/core/src/timebase.ts`、`rational.ts` |
| 帧率转换 / 入出点 / 转场重叠 / 音频位置 | 帧网格吸附、trim 入出点联动、转场 overlap 校验、采样⇄tick |
| 波纹 vs 保留绝对位置删除；对字幕锚点/配乐影响由用户选择 | `ops.ts planDelete` + `DeleteDialog.tsx`（后端按策略**重算**，不信任前端） |
| 并发拖动同片段检测基线冲突，拒绝最后到达覆盖 | `revision` 乐观锁 + 每时间线互斥锁；冲突返回 409；几何操作可按位移意图**重基线** |
| 撤销跨刷新 ≥5 步；他人编辑后重算可逆条件 | `UndoEntry` 表持久化（保留 50 步），撤销前校验文档哈希，失配返回 409 |
| 不同帧率素材 | Seed 含 23.976/24/25/29.97 四档素材混排 |
| 转场长于相邻片段 | 校验拒绝；删除迁移时自动解除 |
| 拖拽中素材被退役 | 退役后引用它的编辑被服务端权威校验拒绝，片段显示“已退役” |
| 保存响应丢失 | `Idempotency-Key`：同键重放首次响应，操作不会应用两次 |
| 预览总长 / 标记位置 / 导出范围同一时间模型 | `timelineDuration` / `markers` / `exportRange` 同源；渲染清单也取自同一快照 |
| 工作线程迟到结果不回滚新编辑 | `analysisClient.ts` 单调 seq + basis 双重过期判定 |
| 数据库拒绝悬空引用 | `prisma/triggers.sql`：素材引用、锚点、轨道、整数 tick、转场、关键点 |

## 🧪 自动化测试

核心时间内核 17 项（有理数整除、丢帧时间码、删除策略、转场迁移/解除、重基线冲突）：

```bash
npm run test:core
```

后端服务层 7 项（并发冲突拒绝覆盖、自动重基线、撤销重算/force、波纹删除、悬空/退役拒绝、冻结渲染、混帧率）：

```bash
npm run test -w backend
```

> 后端服务层测试使用内存 Prisma 替身（`backend/src/test/fakePrisma.ts`），覆盖与生产完全相同的服务/核心代码路径；数据库触发器在容器启动时安装到真实 PostgreSQL。

## 📁 目录结构

```
packages/core/      # 精确时间内核（Rational、tick 时间基、模型、校验、Op、删除策略、rebase、hash）
backend/            # Fastify + Prisma API（鉴权/素材/操作/撤销/渲染/并发模拟/幂等/触发器/seed）
frontend/           # React 多轨剪辑工作台（轨道、标尺、片段、关键点、对话框、Worker）
docker-compose.yml  # db + backend + frontend 一键编排
```
