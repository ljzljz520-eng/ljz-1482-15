# 端到端验收脚本

`test-flow.ts` 针对真实 PostgreSQL（通过 `DATABASE_URL` 指定）执行全部验收场景：

- A 不同帧率素材（23.976/25/29.97/60fps、48kHz 音频）以整数 tick 装载
- B 正常编辑与历史持久化、revision 递增
- C 并发拖动同一片段：旧基线被 409 拒绝，绝不最后到达覆盖
- D 保存响应丢失：同一 clientId 幂等重试，不重复应用
- E 拖拽中素材被退役：引用片段的编辑返回 E_ASSET_RETIRED，冻结版本仍可用
- F 转场长于相邻片段 / 重叠不精确：拒绝
- G 撤销跨刷新：重新加载文档后按持久化逆向补丁恢复
- H 他人编辑后可逆条件失效：E_UNDO_CONFLICT，不产生脏文档
- I 冻结渲染：冻结后继续编辑不影响已提交任务的 EDL / 海报输出
- J 数据库外键物理拒绝悬空引用
- K 预览总长 / 标记 / 导出范围来自同一时间模型（EDL 输出）

## 本地运行（任意可连接的 Postgres 16）

```bash
cd backend
export DATABASE_URL="postgresql://timeline:timeline@localhost:5432/timeline?schema=public"
npx prisma db push --force-reset --accept-data-loss
npx tsx prisma/seed.ts
npx tsx e2e/test-flow.ts
```

在 docker compose 环境中，数据库服务 `db` 已就绪；脚本需要的 `prisma db push` 与 seed
由 `backend/docker-entrypoint.sh` 在容器启动时自动完成。
