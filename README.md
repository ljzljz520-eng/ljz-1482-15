# 云溪多轨时间线编排系统（Timeline Multi-Track Orchestrator）

面向短视频/宣传片剪辑的**全栈多轨时间线编排系统**：React 端拖动片段与关键点，后端校验每一次
操作并写入 PostgreSQL，渲染任务读取**冻结的时间线版本**。全链路使用**明确时间基 + 整数 tick**
与**有理数帧率**，杜绝浮点秒随意累加造成的漂移。

## 🧱 核心设计

### 明确时间基（无浮点累加）

- 主时间线统一为整数 **tick**：`1 秒 = 1,000,000,000 tick`（纳秒精度，`BigInt` 入库）。
- 帧率是有理数 `Rate = num/den`（帧/秒）：`23.976=24000/1001`、`29.97=30000/1001`、`25=25/1`、
  `60=60/1`；音频 `48000/1`。帧↔tick 只走整数运算（`frameToTick` 上取整量化、`tickToFrame` 向下
  取整），保证往返恒等、单调、跨帧率确定。
- 素材**入点/出点**存于素材源速率空间，片段 `duration` 必须精确等于 `outPoint-inPoint`，校验器
  拒绝任何漂移缩放。
- **转场**以显式整数 `overlap`（tick）表达，两片段实际重叠必须与它精确相等；转场不得长于任一侧
  片段。
- **配乐/音频位置**全部是 tick 整数，同轨重叠被拒绝。

代码：`shared/src/time.ts`、`shared/src/validate.ts`、`shared/src/engine.ts`

### 三种删除语义（用户明确选择）

删除片段时弹窗让用户选择，并明确定义对子标题、字幕锚点、标记、配乐的影响：

| 模式 | 时间线 | 子标题/字幕锚点 | 标记 | 配乐 |
|---|---|---|---|---|
| **波纹 ripple** | 右侧内容整体左移；与左/右转场重叠计入净缩短量 | 删除 或 脱钩为绝对位置 | 删除 或 脱钩 | 跟随平移 或 保留绝对位置 |
| **保留绝对位置 keep_absolute** | 只删片段，其余不动（产生空隙/结构冲突则拒绝） | 删除/脱钩 | 删除/脱钩 | 始终保留绝对位置 |
| **提升 lift** | 留空移除 | 同上 | 同上 | 保留绝对位置 |

### 并发编辑：乐观版本 + 咨询锁，绝不“最后到达覆盖”

- 每次提交携带 `baseRevision`；项目级 `pg_advisory_xact_lock` 串行化写事务。
- 基线落后 → `409 E_REVISION_CONFLICT`，响应携带服务端最新文档与冲突原因。前端弹出冲突对话框：
  **在最新基线上重放 / 放弃改动采用最新版 / 强制覆盖（需明确确认）**。
- `(projectId, clientId)` 幂等键：**保存响应丢失**时用同一 clientId 安全重试，服务端只应用一次。

### 撤销：服务端持久化，跨刷新保留，他人编辑后重算可逆条件

- 每个操作编译为规范化**微补丁**，服务端同时持久化正向/逆向补丁（`history_entries`，每项目保留
  最近 100 条；前端至少展示 5 步）。撤销 = 应用逆向补丁 + **重新全量校验**。
- 若他人已在目标位置放入片段导致逆向重放非法 → `409 E_UNDO_CONFLICT`，绝不产生脏文档。

### 冻结版本渲染 & 工作线程迟到保护

- 「冻结并导出」对当前文档打不可变快照（`frozen_timelines.doc/assets` JSON），渲染 worker 只从
  快照产出 EDL/SVG 海报；冻结后继续编辑不影响进行中的任务。素材**退役不删除**（外键 Restrict），
  存量冻结渲染仍可完成，引用退役素材的片段在新编辑中被锁定（`E_ASSET_RETIRED`）。
- 前端布局在 **Web Worker** 中计算，消息携带单调 `generation` 代次令牌：迟到的旧结果直接丢弃，
  **不会回滚更新的编辑**。
- **预览总长、标记位置、导出范围**全部来自 `shared/src/selectors.ts` 同一组纯函数，UI 标尺与 EDL
  导出共用同一时间模型。

### 数据库完整性

片段/转场/关键点/字幕/音频/标记均为规范化表，外键 `onDelete: Restrict`，数据库物理**拒绝悬空引用**；
tick 列为 `BIGINT`。

## 🛠 技术栈

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Zustand + react-hot-toast + Web Worker
- **Shared**: 独立 TypeScript 包（时间基、文档模型、编辑引擎、校验器、选择器；vitest 30 项单元测试）
- **Backend**: Node.js + Fastify 4 + Prisma 5 + Zod（严格 DTO 校验）+ Pino 结构化日志
- **Database**: PostgreSQL 16（持久化 Volume）
- **Render Worker**: 独立容器进程，轮询冻结渲染任务

## 🚀 启动指南（一键）

1. 确保 Docker Desktop / Docker Engine 已启动。
2. 在仓库根目录执行：

```bash
docker compose up --build
```

3. 等待四个容器健康（db 自动 `db push` 建表并写入种子数据）。

## 🔗 服务地址

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Health: http://localhost:8000/health
- Database: localhost:5432（user/pass/db：`timeline / timeline / timeline`）

## 🧑‍🤝‍🧑 演示账号（顶栏切换身份以演示并发冲突）

- 林编辑（user_alice，蓝）
- 陈协作（user_bob，橙）

无需登录；编辑器请求通过 `x-user-id` 头携带身份。

## 📺 演示项目「云溪公园 · 形象片」

种子包含 2 视频轨 + 2 音频轨，素材覆盖 **23.976 / 25 / 29.97 / 60 fps 视频与 48kHz 音频**；
含 1s 溶解转场（精确重叠）、3 个透明度关键点、片段锚定/绝对标记、3 条字幕锚点、2 条配乐。

### 建议的手动验收路径

1. **不同帧率**：检查器中观察片段的整数 tick 与源帧率；标尺按主帧率 25fps 显示时间码。
2. **拖动片段 / 关键点**：自动帧吸附；松手自动保存（顶栏显示 v 版本与保存状态）。
3. **并发冲突**：开两个浏览器窗口，分别切换为林编辑/陈协作，都拖动同一片段，第二个提交会看到
   冲突对话框（不会覆盖）。
4. **保存响应丢失**：同一操作幂等重试只生效一次（后端 e2e 已覆盖）。
5. **删除语义**：选中片段点删除，依次尝试波纹（观察右侧片段/标记/配乐联动）、保留绝对位置、提升，
   并选择字幕脱钩或删除。
6. **转场长于相邻片段**：工具栏「⇄ 转场」只允许合法重叠；任何超长/错位转场被后端拒绝。
7. **拖拽中素材退役**：素材库页点退役某素材 → 回到编辑器拖动引用它的片段 → 收到
   `E_ASSET_RETIRED`，片段锁定。
8. **撤销**：连续编辑后刷新页面，历史面板仍在；点撤销可恢复；用另一身份制造冲突后撤销会得到
   `E_UNDO_CONFLICT` 提示。
9. **冻结渲染**：渲染页点「冻结并导出 EDL / 海报」，任务完成后查看结果；任务执行期间继续编辑不
   影响其输出。
10. **迟到 worker 结果**：快速连续拖动，预览面板底部会显示“已丢弃 N 个迟到预览结果”，画面始终
    对应当前最新文档。

## 🧪 自动化测试

- 纯引擎单元测试（30 项，含全部时间基/删除/转场/冲突/撤销场景）：

```bash
cd shared && npm install && npm test
```

该测试套件在后端 Docker 镜像构建阶段也会执行（`shared/Dockerfile` 构建链中 `npm test`）。

- 真实 PostgreSQL 端到端验收脚本（26 项，见 `backend/e2e/README.md`）：

```bash
cd backend
export DATABASE_URL="postgresql://timeline:timeline@localhost:5432/timeline?schema=public"
npx prisma db push --force-reset --accept-data-loss
npx tsx prisma/seed.ts
npx tsx e2e/test-flow.ts
```

## 📁 目录结构

```
shared/                 # 时间基/模型/引擎/校验/选择器（前后端共用，vitest）
backend/
  prisma/schema.prisma  # 规范化表 + FK Restrict + BIGINT tick
  prisma/seed.ts        # 多帧率演示数据
  src/services/         # mutationService（OCC/幂等/撤销）、docRepository、freezeService、renderer
  src/workers(ts)       # 渲染工作线程入口 src/worker.ts
  src/routes/           # Fastify 路由（Zod 校验）
  e2e/                  # 真实 PG 端到端验收
frontend/
  src/workers/          # 布局预览 Web Worker（generation 令牌）
  src/store/            # Zustand 编辑器状态（乐观更新/冲突/撤销）
  src/components/timeline/  # 多轨、片段块、关键点、标尺、弹窗
  src/pages/            # 编辑器 / 素材库 / 渲染队列
docker-compose.yml      # db + backend + worker + frontend 全容器化
```
