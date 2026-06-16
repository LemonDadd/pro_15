# 功能需求迭代提示词

> 复制下方 **「Agent 提示词」** 整段到 Cursor Agent 执行。

---

## Agent 提示词（复制从这里开始）

**项目路径**：`/Users/ext.feixuan3/Desktop/solo/pro_15`  
**技术栈**：Python 3.10+ · FastAPI · Uvicorn · TqSdk · Pydantic  
**产品定位**：A 股实时行情后端（仅行情，不含下单/持仓/前端页面）

**核心目标**：用户配置快期账号后，能订阅 A 股、REST 查最新价/K 线/Tick、WebSocket 收 tick 推送。

---

### 已有基线（勿整库重写）

- 接口骨架：`/api/health`、`/api/subscribe`、`/api/unsubscribe`、`/api/quote/{symbol}`、`/api/quotes`、`/api/klines/{symbol}`、`/api/query_symbols`、`/ws/quotes`
- `TqMarketEngine` + 后台 `wait_update` 循环；WebSocket 用 `queue.Queue` 桥接
- `.env` + `python-dotenv` 读取账号；`.env.example`、README 安装说明已有
- 实测：正确账号下 `SSE.600000` 可返回 `last_price`；TqSdk 认证常需 **30～60 秒**

---

### 1. 鉴权与启动

- 启动前校验 `TQ_AUTH_USER`、`TQ_AUTH_PASSWORD`，未配置则**拒绝启动**（或 health 503），禁止「服务能起但行情全空」
- `/api/health` 返回：`status`、`engine_ready`、`error`（`auth_missing` / `auth_failed` / `connect_timeout` / `null`）、`subscribed_symbols`
- 新增/沿用 `STARTUP_TIMEOUT`（默认 **60**），仅在 `engine_ready=true` 时打「就绪」日志
- 认证失败、连接超时**不得**误报 ready（`wait_until_ready` 与 `is_ready` 语义一致）
- 凭证只放 `.env`，仓库内禁止明文密码

---

### 2. 行情引擎（单线程 TqApi）

- **所有** `get_quote` / `get_kline_serial` / `get_tick_serial` / `query_quotes` / `query_symbol_info` 只在 `_run_loop` 线程执行
- HTTP / WebSocket 请求线程通过**指令队列**发订阅、查 K 线、查合约，用 `Future` 或 `Event+结果槽` 等回传，禁止直接 `self.api.*`
- 保持单例 `wait_update(deadline=time.time()+N)`；变更检测用 `is_changing(quote, ["last_price","ask_price1","bid_price1","datetime"])`
- TqSdk 断线：连续异常后重建 `TqApi`，重连成功**自动恢复**已订阅列表
- 优雅停机：SIGTERM / lifespan 结束时 `api.close()`、停线程、断开 WS

---

### 3. 股票行情能力

- 环境变量 `DEFAULT_STOCK_SYMBOLS`，默认 `SSE.600000,SSE.600519,SZSE.000001`；引擎就绪后**自动订阅**
- A 股代码：`SSE.600000`（上交所）、`SZSE.000001`（深交所）；README 写清格式
- `POST /api/query_symbols`：支持 `ins_class=STOCK`、`exchange_id=SSE|SZSE`；返回 `symbol` + `instrument_name` + `exchange_id`（用 `query_symbol_info` 补全，不要只返回裸代码）
- **新增** `GET /api/ticks/{symbol}?data_length=200`：返回 Tick 序列（时间、价、量等）
- `GET /api/klines/{symbol}`：保持 OHLCV；在更新线程内 `get_kline_serial`
- WebSocket：客户端 `subscribe` / `unsubscribe`；服务端推 `quote_update`；空闲 30s 发 `ping`
- 行情字段：`symbol`、`instrument_name`、`datetime`、`last_price`、买一卖一价量、开高低收、成交量额

---

### 4. 体验、限制与文档

- 单次订阅上限 **50** 只，超出返回 400 + 明确错误
- 可选 `PERSIST_SUBSCRIPTIONS=true`：订阅列表写本地 JSON，重启后恢复
- 可选 `API_KEY`：非空时 REST/WS 需 `X-API-Key` 头
- README 补充：推荐 `http://127.0.0.1:8000`（`localhost` 可能被系统代理 502）；订阅后 **3～10 秒** 才有首条价；curl + WebSocket 完整示例
- `/docs` 各接口补中文 description 与示例；结构化日志（启动、认证、订阅、重连、队列溢出）
- health 可选增加 `last_update_at`，便于运维判断是否在收行情

---

### 5. 验收（须跑通再交付）

| # | 动作 | 期望 |
|---|------|------|
| 1 | 无 `.env` 启动 | 失败或 health 报 `auth_missing` |
| 2 | 正确账号启动 | 60s 内 `engine_ready: true`，默认 3 只 A 股已订阅 |
| 3 | `GET /api/quote/SSE.600000` | 交易时段 `last_price` 非空 |
| 4 | `POST /api/query_symbols`（STOCK+SSE） | 多条且含 `instrument_name` |
| 5 | `GET /api/ticks/SSE.600000` | 返回 tick 列表 |
| 6 | WebSocket 订 `SSE.600000` | 收到 `quote_update` |
| 7 | 一次订 51 只 | 返回 400 |

---

### 工作方式

1. 先读 `pro_15/tqsdk-skills/tqsdk-trading-and-data/SKILL.md`，再读 `references/market-data.md`、`references/wait-update-and-update-loop.md`
2. 主要改 `app/tq_market.py`、`app/main.py`、`app/config.py`、`app/models.py`；**最小 diff**
3. 有快期账号则实测订阅 + WS；总结列 **已修复 / 未修复**，勿把仅 py_compile 写成「行情已验收」

## Agent 提示词（复制到这里结束）
