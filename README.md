# TqSdk 实时行情后端系统

基于 [TqSdk](https://doc.shinnytech.com/tqsdk/latest/index.html) 开发的股票/期货实时行情后端服务，提供 REST API 和 WebSocket 实时推送。

## 功能特性

- ✅ 实时行情订阅与推送（Quote、K 线、Tick）
- ✅ 单线程 TqApi 架构 + 指令队列，线程安全
- ✅ 自动断线重连，自动恢复订阅
- ✅ A 股股票行情支持（上交所 SSE、深交所 SZSE）
- ✅ 期货行情支持（SHFE、DCE、CZCE、CFFEX、INE 等）
- ✅ REST API + WebSocket 双通道
- ✅ 可选 API Key 鉴权
- ✅ 可选订阅持久化（重启自动恢复）
- ✅ 结构化日志（启动、认证、订阅、重连、队列溢出）
- ✅ 健康检查与状态监控

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写 TqSdk 账号：

```bash
cp .env.example .env
```

```dotenv
# TqSdk 鉴权（必填）
TQ_AUTH_USER=your_tqsdk_username
TQ_AUTH_PASSWORD=your_tqsdk_password

# 服务配置
HOST=0.0.0.0
PORT=8000

# 默认订阅股票（引擎就绪后自动订阅）
DEFAULT_STOCK_SYMBOLS=SSE.600000,SSE.600519,SZSE.000001
```

> TqSdk 账号注册：<https://www.shinnytech.com/>

### 3. 启动服务

```bash
python run.py
```

服务启动后访问 <http://127.0.0.1:8000/docs> 查看 Swagger API 文档。

> ⚠️ **注意**：推荐使用 `127.0.0.1` 而非 `localhost`，部分系统的代理配置可能导致 `localhost` 出现 502 错误。

> ⚠️ **行情延迟**：订阅后通常需要 **3～10 秒** 才能收到首条行情数据，请耐心等待。

## 合约代码格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 上交所 A 股 | `SSE.6位代码` | `SSE.600000`（浦发银行） |
| 深交所 A 股 | `SZSE.6位代码` | `SZSE.000001`（平安银行） |
| 上期所期货 | `SHFE.品种+月份` | `SHFE.rb2610` |
| 大商所期货 | `DCE.品种+月份` | `DCE.i2609` |
| 郑商所期货 | `CZCE.品种+月份` | `CZCE.SR609` |
| 中金所期货 | `CFFEX.品种+月份` | `CFFEX.IF2609` |
| 主连合约 | `KQ.m@交易所.品种` | `KQ.m@SHFE.rb` |

> 完整合约列表可通过 `POST /api/query_symbols` 查询。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TQ_AUTH_USER` | - | **必填** TqSdk 快期账号 |
| `TQ_AUTH_PASSWORD` | - | **必填** TqSdk 快期密码 |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `PORT` | `8000` | 服务监听端口 |
| `STARTUP_TIMEOUT` | `60` | 引擎启动超时时间（秒） |
| `UPDATE_LOOP_DEADLINE` | `5` | wait_update 轮询间隔（秒） |
| `DEFAULT_STOCK_SYMBOLS` | `SSE.600000,SSE.600519,SZSE.000001` | 引擎就绪后自动订阅的合约 |
| `MAX_SUBSCRIBE_PER_REQUEST` | `50` | 单次订阅/取消订阅上限 |
| `MAX_TOTAL_SUBSCRIPTIONS` | `500` | 总订阅数上限 |
| `PERSIST_SUBSCRIPTIONS` | `false` | 是否持久化订阅列表 |
| `SUBSCRIPTIONS_FILE` | `./subscriptions.json` | 持久化文件路径 |
| `API_KEY` | - | REST/WS 鉴权密钥（空则不启用） |
| `MAX_WS_QUEUE_SIZE` | `100` | 每个 WebSocket 连接的队列大小 |

## REST API

所有接口的完整文档和在线调试请访问 <http://127.0.0.1:8000/docs>。

### 健康检查

```bash
curl http://127.0.0.1:8000/api/health
```

响应：
```json
{
  "status": "ok",
  "engine_ready": true,
  "error": null,
  "subscribed_symbols": ["SSE.600000", "SSE.600519"],
  "last_update_at": "2026-06-15T10:30:00.123456"
}
```

`status` 取值：
- `ok`：引擎正常运行
- `degraded`：连接超时，正在重连
- `unavailable`：不可用（鉴权失败或未配置）

`error` 取值：
- `auth_missing`：未配置鉴权信息
- `auth_failed`：鉴权失败（账号密码错误）
- `connect_timeout`：连接超时
- `null`：无错误

### 订阅行情

```bash
curl -X POST http://127.0.0.1:8000/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["SSE.600000", "SZSE.000001"]}'
```

### 取消订阅

```bash
# 单个
curl -X DELETE http://127.0.0.1:8000/api/unsubscribe/SSE.600000

# 批量
curl -X DELETE "http://127.0.0.1:8000/api/unsubscribe?symbols=SSE.600000,SZSE.000001"
```

### 获取最新行情

```bash
curl http://127.0.0.1:8000/api/quote/SSE.600000
```

### 获取 K 线

```bash
curl "http://127.0.0.1:8000/api/klines/SSE.600000?duration_seconds=60&data_length=200"
```

### 获取 Tick 行情

```bash
curl "http://127.0.0.1:8000/api/ticks/SSE.600000?data_length=200"
```

### 查询合约列表

```bash
curl -X POST http://127.0.0.1:8000/api/query_symbols \
  -H "Content-Type: application/json" \
  -d '{"ins_class": "STOCK", "exchange_id": "SSE", "expired": false}'
```

### 使用 API Key

如果配置了 `API_KEY`，请求需携带 `X-API-Key` 头：

```bash
curl http://127.0.0.1:8000/api/health \
  -H "X-API-Key: your_api_key"
```

## WebSocket

### 连接

```
ws://127.0.0.1:8000/ws/quotes
```

### 客户端命令

#### 订阅
```json
{"type": "subscribe", "symbols": ["SSE.600000", "SZSE.000001"]}
```

响应：
```json
{"type": "subscribe_result", "subscribed": ["SSE.600000"], "already_subscribed": ["SZSE.000001"]}
```

#### 取消订阅
```json
{"type": "unsubscribe", "symbols": ["SSE.600000"]}
```

响应：
```json
{"type": "unsubscribe_result", "unsubscribed": ["SSE.600000"], "not_subscribed": []}
```

#### 心跳
- 服务端空闲 30 秒发送 `ping`
- 客户端应回复 `pong`
- 客户端也可主动发 `ping`，服务端回复 `pong`

### 服务端推送

行情更新时推送：
```json
{
  "type": "quote_update",
  "data": {
    "symbol": "SSE.600000",
    "datetime": "2026-06-15 10:30:00.000000",
    "instrument_name": "浦发银行",
    "last_price": 10.5,
    "ask_price1": 10.51,
    "ask_volume1": 1000,
    "bid_price1": 10.49,
    "bid_volume1": 2000,
    "open": 10.3,
    "high": 10.6,
    "low": 10.25,
    "close": 10.5,
    "volume": 12345678,
    "amount": 129876543.21
  }
}
```

### Python 客户端示例

```python
import asyncio
import json
from websockets import connect


async def main():
    async with connect("ws://127.0.0.1:8000/ws/quotes") as ws:
        # 订阅
        await ws.send(json.dumps({
            "type": "subscribe",
            "symbols": ["SSE.600000", "SSE.600519"]
        }))

        # 接收推送
        while True:
            msg = await ws.recv()
            data = json.loads(msg)
            if data["type"] == "quote_update":
                q = data["data"]
                print(f"{q['symbol']} {q['last_price']}")
            elif data["type"] == "ping":
                await ws.send(json.dumps({"type": "pong"}))


asyncio.run(main())
```

## 架构说明

```
┌─────────────────┐     ┌──────────────────────────┐
│   HTTP / WS     │     │   工作线程 (_run_loop)    │
│   请求线程      │────▶│  ┌────────────────────┐  │
└─────────────────┘     │  │   指令队列 Queue   │  │
                        │  └─────────┬──────────┘  │
                        │            │             │
                        │  ┌─────────▼──────────┐  │
                        │  │ wait_update 循环   │  │
                        │  │ (TqSdk 单线程)     │  │
                        │  └─────────┬──────────┘  │
                        │            │             │
                        │  ┌─────────▼──────────┐  │
                        │  │  行情变更检测      │  │
                        │  │  (is_changing)     │  │
                        │  └─────────┬──────────┘  │
                        │            │             │
                        │  ┌─────────▼──────────┐  │
                        │  │ WebSocket 推送队列 │  │
                        │  └────────────────────┘  │
                        └──────────────────────────┘
```

### 核心设计原则

1. **单线程 TqApi**：所有 TqSdk API 调用都在独立的工作线程执行，避免多线程竞争
2. **指令队列**：HTTP/WS 请求通过 `_cmd_queue` 提交指令，`Event + 结果槽` 回传结果
3. **自动重连**：TqSdk 异常断线后，指数退避重连（最长 30 秒），成功后自动恢复所有订阅
4. **优雅停机**：收到 SIGTERM 或 FastAPI lifespan 结束时，`api.close()` + 停线程 + 断开 WS

## 常见问题

### Q: 为什么订阅后很久没数据？

A: TqSdk 建立连接和数据订阅需要时间，通常 3～10 秒。如果超过 30 秒仍无数据，请检查：
1. 账号密码是否正确
2. 网络是否能访问 TqSdk 服务器
3. 合约代码格式是否正确

### Q: 支持多少只合约同时订阅？

A: 默认总上限 500 只，单次最多 50 只。可通过 `MAX_TOTAL_SUBSCRIPTIONS` 调整。实际数量受 TqSdk 账号权限和网络带宽限制。

### Q: 怎么查询所有 A 股股票？

A: 目前 `query_symbols` 只返回前 50 条。建议用 `ins_class=STOCK` + `exchange_id=SSE/SZSE` 分区查询。

### Q: 服务重启后订阅都没了？

A: 开启 `PERSIST_SUBSCRIPTIONS=true`，订阅列表会保存到本地 JSON，重启自动恢复。

## 目录结构

```
pro_15/
├── app/
│   ├── __init__.py
│   ├── config.py          # 配置与环境变量
│   ├── main.py            # FastAPI 入口与路由
│   ├── models.py          # Pydantic 数据模型
│   └── tq_market.py       # TqSdk 行情引擎（核心）
├── tqsdk-skills/           # TqSdk 技能包文档
├── .env.example           # 环境变量示例
├── requirements.txt       # Python 依赖
├── run.py                 # 启动脚本
└── README.md              # 本文档
```

## 相关文档

- [TqSdk 官方文档](https://doc.shinnytech.com/tqsdk/latest/index.html)
- [TqSdk Python API](https://doc.shinnytech.com/tqsdk/latest/reference/index.html)
