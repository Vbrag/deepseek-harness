# 编排

[English](orchestration.md) | 中文

编排模式根据任务评估、所需输入、上下文估算和可用容量，为普通新建子代理分配获准的模型路由。主代理保留会话模型。默认模式保留普通委派行为。[服务参考](../../packages/experimental/dsh-orchestration/README.zh.md)定义配置；[子代理运行时](subagent.zh.md)负责准入、子代理执行和清理。

## 任务评估与资格

普通启动请求携带必需和偏好的能力、包含预期视觉输入的所需模态、上下文 Token 估算及可选输出要求。必需能力取交集：编码加视觉验证要求同时具备编码和图像理解能力。仅有推理专长不能满足编码要求。未知能力不能证明符合条件。

适配器提供精确路由元数据。显式限制优先于整理的能力资料；配置的任务专长覆盖仅作用于精确的提供商与模型组合。路由器结合传递内容和主代理估算，考虑配置的提示与工具开销及响应预留。在组装子代理提示和工具后，仍以实际请求验证为准。

## 容量与模型生命周期

符合条件且可立即使用的路由先按任务匹配度排序，再考虑活跃分配数量和模型池顺序。兼容但需等待的路由优先于不兼容但可立即使用的路由。分配统计衡量跨会话负载；只有适配器在实际发送时预留请求和 Token 配额。已启动子代理保持其路由；配额压力不会在另一模型上重放其工作。

## 模式与授权

已提交的会话模式会记录并投影。轮次中的选择在下一个被接受且未取消的步骤生效。新建子代理在准入等待前保存父代理已提交的模式，并在第一次请求前记录此选择。之后修改父代理模式不会改变现有子代理的模式。

已有模型权限限制路由，历史记录中缺少策略时仅允许父路由。现有模型选择设置所有者根据显式设置或路由器所选池初始化新根会话的权限。修改模型池不会扩大已有会话的权限。

主机目录端点返回 `OrchestrationCatalog`，包含提供商标识及整理的模型能力记录。Web 面板通过 Remote 读取这些内容，而不导入主机运行时值。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxorchestrations--orchestrationservice"></a>

### `ctx.orchestrations` — `OrchestrationService`

Mode and pool owner; one registered selector serves every normal local delegation.

```ts cordis-catalog
/** Read the applied logged mode; pending selections affect only the next accepted step.
 * @param agent - Session owner.
 * @returns Applied mode for new delegations.
 */
modeOf(agent: Agent): boolean

/** Record a selection immediately between turns, or queue it durably within a turn.
 * @param agent - Session owner.
 * @param active - Desired mode.
 */
setMode(agent: Agent, active: boolean): void

/** Select mode without losing pending intent on restart or plugin replacement.
 * @param agent - Session owner.
 * @param active - Desired mode.
 * @returns Whether the selection committed, queued, cancelled a pending choice, or already matched.
 */
select(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'

/** Read the default pool; recorded Session policies independently constrain every delegation.
 * @returns Detached exact routes in configured order.
 */
@Remote('getPool') getPool(): readonly PoolRoute[]

/** Project the pool picker catalog from the live LLM registry, not a static list.
 * Providers and models are taken from `ctx.llm.listProviders()`/`listModels()`,
 * so the picker matches the models the composer can actually select. Curated
 * specialties/capacity from the Paderborn catalogue apply only to known
 * `uni-paderborn` routes; everything else carries live adapter metadata.
 * @returns Detached per-provider model facts used by the pool picker.
 */
@Remote('getCatalog') async getCatalog(): Promise<OrchestrationCatalog>

/** Replace the pool in memory; existing Session authorization is never widened.
 * @param pool - Exact routes, possibly empty to disable automatic selection.
 */
@Remote('setPool') setPool(pool: readonly PoolRoute[]): void

/** Apply the pool and persist it in this profile's settings.
 * The in-memory pool is replaced unconditionally; persistence is best-effort
 * but reported honestly. A refused or failed settings write (for example, a
 * profile that owns the `orchestration` entry in a shipped layer rather than a
 * user layer) makes this resolve `false` so the picker can show a save failure
 * instead of claiming a save that never happened.
 * @param pool - New default routes; existing Session authorization remains fixed.
 * @returns True only when the pool was applied in memory AND persisted to settings.
 */
@Remote('persistPool') async persistPool(pool: readonly PoolRoute[]): Promise<boolean>
```

Types: [Agent](core.zh.md)

Source: [`packages/experimental/dsh-orchestration/src/index.ts`](../../packages/experimental/dsh-orchestration/src/index.ts)
<!-- END GENERATED cordis-surface -->
