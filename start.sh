#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
DIST_DIR="$FRONTEND_DIR/dist"

echo "============================================"
echo "  TqSdk 行情系统 - 统一启动"
echo "============================================"

if [ ! -d "$DIST_DIR" ] || [ ! -f "$DIST_DIR/index.html" ]; then
    echo ""
    echo "[1/2] 构建前端..."
    cd "$FRONTEND_DIR"
    npm install --silent
    npm run build
    echo "✓ 前端构建完成"
else
    echo ""
    echo "[1/2] 前端已构建，跳过（删除 $DIST_DIR 可强制重建）"
fi

echo ""
echo "[2/2] 启动后端服务（含前端静态文件）..."
echo "  访问地址: http://127.0.0.1:8000"
echo "  API文档:  http://127.0.0.1:8000/docs"
echo ""

cd "$ROOT_DIR"

if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
fi

python run.py
