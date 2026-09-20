#!/bin/zsh
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22 或更高版本：https://nodejs.org/"
  read -r "reply?按回车退出"
  exit 1
fi
node scripts/setup.mjs || exit 1
node scripts/local-service.mjs install --open
if [[ $? -ne 0 ]]; then
  read -r "reply?启动未完成，按回车退出"
  exit 1
fi
