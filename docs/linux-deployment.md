# 阿里云 ECS 部署

已于 **2026-09-20** 部署到 `8.147.71.90`。公开入口为 **[http://8.147.71.90](http://8.147.71.90)**；应用进程仅监听服务器自己的 `127.0.0.1:4173`，由服务器原有宝塔 Nginx 转发请求。当前使用 HTTP 公网 IP，未配置域名和 HTTPS；日后启用时须同时修改 Nginx 和 `PUBLIC_ORIGIN`。

当前转诊、照护、接收登记等记录仍保存在各自浏览器的本地存储中；不同电脑之间没有共享患者数据库、真实院方接口或人员账号权限。页面中的上级与下级视图读取同一浏览器档案，尚无跨院业务后端。由本地网址改用公网网址，也不会自动迁移原浏览器记录。

## 当前部署清单

| 项目 | 已部署配置 |
| --- | --- |
| 源码 | [GitHub 仓库](https://github.com/doyoulikelin-wq/anzhen_fde)，应用提交 `0e93362`；后续文档提交可能不同 |
| 系统 | Alibaba Cloud Linux 4.0.6，x86_64 |
| Node.js | `/opt/anzhen-runtime/node-v24.21.0-linux-x64/bin/node`，官方发行包，SHA-256 校验通过 |
| 当前版本 | `/opt/anzhen-fde/current` → `/opt/anzhen-fde/releases/20260920-0e93362` |
| 应用服务 | `anzhen-fde.service`，独立非 root 账户 `anzhen`，已启用开机启动和进程退出重启 |
| 服务器私有配置 | `/etc/anzhen-fde/app.env`，root 所有、权限 `0600`；仅含应用配置及 API Key，不含 SSH 密码 |
| 公网站点配置 | `/www/server/panel/vhost/nginx/anzhen-fde.conf`，新增独立站点，保留原有宝塔配置与其他站点 |
| Nginx 管理 | 由宝塔管理；执行 `nginx -t && nginx -s reload`，不要使用 `systemctl reload nginx` |

Node.js 来源为 [官方下载页](https://nodejs.org/en/download) 对应的 [v24.21.0 发行目录](https://nodejs.org/dist/v24.21.0/)；下载包已按该目录的 SHA-256 清单核对。服务器的 `nginx.service` 在 systemd 中显示 inactive，这是现有宝塔管理方式的结果，不代表公网 Nginx 进程停止。

## 文件职责

| 文件 | 用途 |
| --- | --- |
| `deploy/anzhen-fde.service` | 非 root 的 `anzhen` 账户运行应用；异常退出自动重启；系统登录不影响进程 |
| `deploy/nginx.conf.example` | 独立站点模板，保留原始 Host 和 Origin，上传上限 6 MB，模型响应等待上限 200 秒 |
| `deploy/app.env.example` | 仅包含空密钥的服务器环境配置模板 |
| `deploy/install.sh` | 复制必要运行文件到新版本目录、切换版本、健康检查、失败时恢复旧版本 |

## 连接和检查

在自己的终端输入以下命令，然后在 SSH 的密码提示处输入密码。输入不会显示字符；不需要把密码贴到聊天、命令参数或 GitHub。

```sh
ssh root@8.147.71.90
```

首次连接时，先核对 SSH 主机指纹与阿里云控制台提供的信息。后续可使用专用 SSH 公钥登录；私钥只保留在自己的电脑上。

部署前查看系统、运行环境、已有站点和端口，避免替换已有服务：

```sh
cat /etc/os-release
command -v node
node --version
systemctl --version
ss -ltnp
nginx -T
df -h /opt
```

需要 Node.js 22 或更高版本、systemd、curl、iproute2 提供的 `ss`，以及 Nginx。应用没有第三方 npm 运行依赖，不需要执行 `npm install`。部署脚本不会自行安装 Node.js 或系统软件，也不会修改现有 Nginx 站点和防火墙。安装系统软件时，应按实际发行版选择官方软件源与适用命令。

## 后续上传与配置

当前服务器已完成以下配置。后续发布复用私有配置和独立站点，不覆盖原 API Key、不重新创建现有站点。

从已检查的 GitHub 提交创建不包含本地 `.env` 的发布包，例如：

```sh
git archive --format=tar.gz --output=/tmp/anzhen-fde-release.tar.gz HEAD
scp /tmp/anzhen-fde-release.tar.gz root@8.147.71.90:/root/
```

在服务器新建上传目录并解包，再运行安装器。以下假定仓库根目录就是 Web App；若实际仓库有外层目录，以 `server.mjs` 所在目录为准。

```sh
mkdir -p /root/anzhen-fde-upload
tar -xzf /root/anzhen-fde-release.tar.gz -C /root/anzhen-fde-upload
cd /root/anzhen-fde-upload
ANZHEN_NODE_BIN=/opt/anzhen-runtime/node-v24.21.0-linux-x64/bin/node bash deploy/install.sh "$PWD"
```

在一台尚未配置的新服务器首次运行时，安装器会创建 `/etc/anzhen-fde/app.env`，然后停止，提示填写配置。当前服务器已配置，不必重复此步骤。需要变更 Key 时可在服务器终端用编辑器修改：

```sh
vi /etc/anzhen-fde/app.env
```

保留 `PORT=4173`，公网入口设为 `PUBLIC_ORIGIN=http://8.147.71.90`。API Key 仅留在这个 root 可读的文件中，权限为 `0600`；不要将填好的环境文件复制进源码、发布包或公开目录。随后再次运行安装器：

```sh
ANZHEN_NODE_BIN=/opt/anzhen-runtime/node-v24.21.0-linux-x64/bin/node bash deploy/install.sh "$PWD"
```

默认 Node.js 在 `/usr/bin/node`。如果服务器使用其他安装路径，可显式指定；该路径必须能由服务账户执行，且不能位于受保护的 `/root`、`/home` 或 `/run/user` 目录中：

```sh
ANZHEN_NODE_BIN=/opt/anzhen-runtime/node-v24.21.0-linux-x64/bin/node bash deploy/install.sh "$PWD"
```

版本保存在 `/opt/anzhen-fde/releases/<release-id>`，`/opt/anzhen-fde/current` 指向当前版本。应用以独立非登录账户运行。安装器不会复制 `.env`、Git 历史、测试截图或用户浏览器记录。

## 公网入口与宝塔 Nginx

当前已新增独立配置 `/www/server/panel/vhost/nginx/anzhen-fde.conf`，没有替换默认站点或其他宝塔配置。此服务器由现有宝塔 Nginx 提供代理，不通过 systemd 的 `nginx.service` 管理。修改配置后执行：

```sh
nginx -t && nginx -s reload
```

只有配置校验成功才重载 Nginx。迁移至其他服务器时，先根据 `nginx -T` 确定实际 include 目录和已有站点归属，再把 `deploy/nginx.conf.example` 作为新站点安装；不要照搬另一台机器的配置路径或覆盖已有站点。阿里云安全组和主机防火墙需放行实际使用的 Web 端口；4173 无需对公网开放。SSH 端口继续按已有管理要求控制。

配置域名 HTTPS 后，将 `PUBLIC_ORIGIN` 改为准确的 `https://域名`，然后重启应用；Nginx 继续传递原始 Host、Origin，并设置 `X-Forwarded-Proto $scheme`。应用按明确配置的公开地址检查请求，不通过伪造为 localhost 的 Host 绕过来源检查。没有账号控制时，所有能访问公开地址的人也能调用 AI 接口；需要限制范围时应在网关层设置访问控制，并测试浏览器与健康检查行为。

## 验证与维护

2026-09-20 已完成的部署检查：

- 服务器执行 140 项自动化测试，全部通过。
- 首次安装失败的回滚路径已验证，未遗留错误的 `current` 链接；发布入口通过软链接启动的回归测试通过。
- 对应用进程发送 SIGTERM 后，systemd 约 6 秒恢复服务，随后健康检查成功。
- 从外部网络完成 10 项 HTTP 检查：主页标题、健康接口、54 人名册、5 个私密或后端路径返回 404、异常 Host/Origin 返回 403；54 张医生照片全部返回 200。

这批部署检查不调用模型。云端真实 AI 流程验收另行记录于 [验证记录](verification.md)；本地模型测试通过不能替代云端网络、Key 和实际页面操作验收。开机启动已配置，但未以整机重启验证。

先验证服务，再验证经 Nginx 的入口：

```sh
systemctl status anzhen-fde --no-pager
curl --fail http://127.0.0.1:4173/api/health
curl --fail -H 'Host: 8.147.71.90' http://127.0.0.1/api/health
journalctl -u anzhen-fde -n 60 --no-pager
```

健康端点应返回 `status: ok` 与 `service: anzhen-referral-workspace`。它不调用模型，不代表 API Key 或模型网络已验证。再从外部浏览器访问 `http://8.147.71.90`，检查首页三个入口、医生照片、一次匹配和一次问答；图片识别和紧急通知整理分别进行少量真实请求验证。核对异常来源请求被拒绝，`.env` 和源码配置文件无法通过 HTTP 读取。

常用操作：

```sh
systemctl restart anzhen-fde
systemctl stop anzhen-fde
systemctl start anzhen-fde
journalctl -u anzhen-fde -f
```

后续发布上传新的已检查版本，再运行安装器即可。它在端口被其他进程占用时停止，不杀掉无关服务；切换版本后的本机健康检查失败会恢复上一版链接和服务文件。安装器不会删除历史版本，不会更新环境文件内容，不会安装自动更新 Webhook。进程重启会中断正在执行的 AI 请求，选择空闲时发布即可；当前方案是单实例部署，不提供零停机切换。

回滚失败时，先查看日志和 `/opt/anzhen-fde/current`，不要盲目重复安装。恢复后仍需重新验证 Nginx、公网访问与一次 AI 请求；本机健康检查通过不等于整个公网链路通过。
