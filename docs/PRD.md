# PRD：TqSdk A 股实时行情后端

| 项目 | pro_15 |
|------|--------|
| 版本 | v0.3 |
| 日期 | 2026-06-15 |
| 状态 | 骨架已跑通，按下列需求迭代 |

**定位**：对接业务系统的 A 股实时行情 API（仅行情，不含交易与前端）。

**现状**：FastAPI + TqSdk 已能订阅、查价、WS 推送；账号正确时 `SSE.600000` 实测有价；启动常需 30～60s。待修：强制鉴权、单线程 TqApi、股票开箱即用、Tick 接口等。

**非目标**：下单/持仓、行情页面、多租户计费、自建行情集群。

---

## 1. 鉴权与启动

- 未配 `TQ_AUTH_USER/PASSWORD` 拒绝启动，禁止空跑
- health 返回 `engine_ready` + `error`（`auth_missing` / `auth_failed` / `connect_timeout`）
- `STARTUP_TIMEOUT` 默认 60s；仅真正就绪时打 ready 日志
- 凭证仅 `.env`，仓库无明文密码

## 2. 行情引擎

- 全部 TqApi 调用只在 `_run_loop` 更新线程；HTTP/WS 走指令队列
- 单例 `wait_update` + `is_changing` 过滤推送字段
- 断线自动重连并恢复订阅列表
- 优雅停机：关闭 TqApi、停线程、断 WS

## 3. 股票行情

- 启动自动订默认 A 股：`SSE.600000`、`SSE.600519`、`SZSE.000001`（可 env 覆盖）
- 代码格式：`SSE.*` 上交所、`SZSE.*` 深交所
- `query_symbols` 查 STOCK，返回代码 + 名称 + 交易所
- 接口：查价、批量价、K 线、**Tick（新增）**、WebSocket `quote_update`
- 行情含：名称、时间、最新价、买卖盘、开高低收、量额

## 4. 体验与运维

- 单次订阅 ≤ 50；可选订阅持久化、可选 API Key
- README：`127.0.0.1` 访问、首价需等数秒、curl/WS 示例
- `/docs` 中文说明；日志覆盖启动/认证/订阅/重连
- health 可选 `last_update_at`

## 5. 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 引擎状态 |
| POST | `/api/subscribe` | 批量订阅 |
| DELETE | `/api/unsubscribe/{symbol}` | 取消 |
| GET | `/api/quote/{symbol}` | 最新价 |
| GET | `/api/quotes` | 已订阅全部 |
| GET | `/api/klines/{symbol}` | K 线 |
| GET | `/api/ticks/{symbol}` | Tick（新增） |
| POST | `/api/query_symbols` | 查 A 股列表 |
| WS | `/ws/quotes` | 实时推送 |

## 6. 环境变量

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `TQ_AUTH_USER` | 是 | — | 快期账号 |
| `TQ_AUTH_PASSWORD` | 是 | — | 快期密码 |
| `STARTUP_TIMEOUT` | 否 | 60 | 启动等待秒数 |
| `DEFAULT_STOCK_SYMBOLS` | 否 | 三只默认股 | 自动订阅 |
| `API_KEY` | 否 | 空 | 接口鉴权 |
| `PERSIST_SUBSCRIPTIONS` | 否 | false | 订阅持久化 |
| `HOST` / `PORT` | 否 | 0.0.0.0 / 8000 | 监听 |

## 7. 验收标准

1. 无账号 → 启动失败或 health 报 auth 问题  
2. 有账号 → 60s 内就绪，默认股已订阅  
3. 查 `SSE.600000` → `last_price` 非空（交易时段）  
4. 查合约列表 → 含 `instrument_name`  
5. Tick 接口有数据  
6. WebSocket → 收 `quote_update`  
7. 订 51 只 → 400  

## 8. 风险

- 快期账号错/过期 → 启动校验 + health error  
- 认证慢 → 调大 `STARTUP_TIMEOUT`  
- 系统代理 → 用 `127.0.0.1` 勿用 `localhost`  
- TqSdk 非线程安全 → 必须指令队列架构  

## 9. 后续（v1.1+）

- 历史数据 `DataDownloader`、Redis 缓存、Prometheus 指标、期货扩展
