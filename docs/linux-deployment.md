# 阿里云 ECS 部署

已于 **2026-09-20** 部署到 `8.147.71.90`；本页公网入口与证书运维信息于 **2026-10-15** 现场复核。公开入口为 **[https://8.147.71.90](https://8.147.71.90)**，普通 HTTP 请求重定向至 HTTPS。应用进程仅监听服务器自己的 `127.0.0.1:4173`，由服务器原有宝塔 Nginx 转发请求。当前使用 Let's Encrypt 签发的公网 IP 短期证书，已配置自动续期，无需域名即可访问此 HTTPS 入口。

在线转诊、照护、接收登记、连续监测和告警统一保存在服务器持久目录 `/var/lib/anzhen-fde`。不同电脑访问同一服务时共享业务记录，页面约每 5 秒检查更新；页面中的上级与下级视图读取同一档案。医生资料与照片随代码部署，模拟照护数据首次启动时初始化。当前仍未连接真实院方接口或人员账号权限系统，所有访问者共用一个工作区。

## 当前部署清单

| 项目 | 已部署配置 |
| --- | --- |
| 源码 | [GitHub 仓库](https://github.com/doyoulikelin-wq/anzhen_fde)，实际运行版本以服务器 `current` 链接为准 |
| 系统 | Alibaba Cloud Linux 4.0.6，x86_64 |
| Node.js | `/opt/anzhen-runtime/node-v24.21.0-linux-x64/bin/node`，官方发行包，SHA-256 校验通过 |
| 当前版本 | `/opt/anzhen-fde/current` → `/opt/anzhen-fde/releases/<release-id>` |
| 应用服务 | `anzhen-fde.service`，独立非 root 账户 `anzhen`，已启用开机启动和进程退出重启 |
| 服务器私有配置 | `/etc/anzhen-fde/app.env`，root 所有、权限 `0600`；仅含应用配置及 API Key，不含 SSH 密码 |
| 共享业务记录 | `/var/lib/anzhen-fde`，`anzhen:anzhen` 所有、目录权限 `0700`；与代码版本和公开资源分开 |
| 公网站点配置 | `/www/server/panel/vhost/nginx/anzhen-fde.conf`，新增独立站点，保留原有宝塔配置与其他站点 |
| Nginx 管理 | 使用宝塔 Nginx 与 `/etc/rc.d/init.d/nginx`；systemd 生成的 `nginx.service` 可执行 reload，2026-10-15 已成功验证 |
| HTTPS 证书 | `/etc/letsencrypt/live/8.147.71.90/`，Certbot 管理的短期 IP 证书；当前续期方式为 webroot |
| 证书验证目录 | `/var/www/anzhen-acme/.well-known/acme-challenge/`，只对本站 HTTP challenge 路径开放 |
| 自动续期 | `anzhen-cert-renew.timer` 每日 00:00、12:00 检查，最多附加 15 分钟随机延迟；只续期 `8.147.71.90`，成功后 reload Nginx |

Node.js 来源为 [官方下载页](https://nodejs.org/en/download) 对应的 [v24.21.0 发行目录](https://nodejs.org/dist/v24.21.0/)；下载包已按该目录的 SHA-256 清单核对。2026-10-15 复核时，`nginx.service` 的 `FragmentPath` 为 `/run/systemd/generator.late/nginx.service`，`SourcePath` 为 `/etc/rc.d/init.d/nginx`，状态为 `active (exited)`；`ExecReload` 调用该脚本的 `reload`。这是 SysV 脚本生成的 systemd 包装单元，不能仅因 `MainPID=0` 或 `exited` 判断 Nginx 停止。实际 reload 成功记录及公网检查见下文。

## 文件职责

| 文件 | 用途 |
| --- | --- |
| `deploy/anzhen-fde.service` | 非 root 的 `anzhen` 账户运行应用；异常退出自动重启；系统登录不影响进程；只向独立持久目录写业务记录 |
| `deploy/nginx.conf.example` | 独立站点模板，保留原始 Host 和 Origin，3.2.0 模板请求体上限 8 MB，模型响应等待上限 200 秒 |
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

保留 `PORT=4173`，当前公网入口对应 `PUBLIC_ORIGIN=https://8.147.71.90`。API Key 仅留在这个 root 可读的文件中，权限为 `0600`；不要将填好的环境文件复制进源码、发布包或公开目录。`DATA_DIR=/var/lib/anzhen-fde` 已由 systemd 单元提供默认值，原有环境配置无需补写也可使用共享存储；如需指定其他目录，应同时为服务账户设置目录权限并调整 systemd 写入许可。随后再次运行安装器：

```sh
ANZHEN_NODE_BIN=/opt/anzhen-runtime/node-v24.21.0-linux-x64/bin/node bash deploy/install.sh "$PWD"
```

默认 Node.js 在 `/usr/bin/node`。如果服务器使用其他安装路径，可显式指定；该路径必须能由服务账户执行，且不能位于受保护的 `/root`、`/home` 或 `/run/user` 目录中：

```sh
ANZHEN_NODE_BIN=/opt/anzhen-runtime/node-v24.21.0-linux-x64/bin/node bash deploy/install.sh "$PWD"
```

版本保存在 `/opt/anzhen-fde/releases/<release-id>`，`/opt/anzhen-fde/current` 指向当前版本。应用以独立非登录账户运行。安装器不会复制 `.env`、Git 历史、测试截图或用户浏览器记录。运行文件白名单包含共享客户端和持久存储模块；发布、重启或回滚代码不会覆盖 `/var/lib/anzhen-fde` 中的数据。

## 共享记录、旧版迁移与备份

每次在线保存都会提交服务器，其他浏览器通过约 5 秒一次的同步获取更新。预置的 3 位患者及各自 7 日监测只在全新数据空间中建立，服务重启和升级不会反复创建或重置；共享数据不是写入公开静态目录的下载文件。当前数据写入由单个应用进程管理，不应让多个实例同时使用同一持久目录。

当前状态文件为 `workspace.json`，上一份已确认状态保存在 `workspace.backup.json`，文件权限均为 `0600`。写入先落临时文件、刷新后原子替换，并校验记录版本以拒绝过时覆盖。主文件损坏时可用有效备份恢复，同时保留带时间戳的损坏副本；主文件和备份均无效时停止启动，不以默认场景重置已有数据。上一版状态不是完整历史备份，仍需根据使用需求另做保留策略。

3.2.0 的病历与影像附件另存于该持久目录中的 `attachments/`：二进制文件和元数据权限为 `0600`，目录为 `0700`。单文件上限 5 MB，经 Base64 编码后的上传请求大于原文件；升级时须核对实际 Nginx 站点的 `client_max_body_size 8m`，仅更新源码模板不会自动修改正在运行的站点。工作区 JSON 只保存附件引用，备份与迁移应复制完整持久目录，不能只复制两个 JSON 文件。移除申请草稿中的附件关联不执行服务器文件永久删除。

首次使用新版时，当前网址下旧版浏览器的上转、下转记录会尝试一次性合并到服务器；完成后标记已迁移，避免每次打开都重复导入。`http://127.0.0.1:4173`、历史 `http://8.147.71.90` 与当前 `https://8.147.71.90` 属于不同浏览器来源，云端页面无法自动读取另一个来源的本地存储。需要搬迁本地历史时，从原来源提取后通过迁移入口合并，再核对数量、日期及接收状态；成功核对前保留原浏览器存储。已经保存在服务器的业务记录不因 HTTP 重定向或证书更新而重置。

服务器既有记录与状态在 3.2.0 中保留。首次迁入且未包含审核信息的旧上转记录会转为待审核，保留原接收字段、原事件及补充迁入说明；现有新版审核状态不被旧浏览器覆盖。新患者、审核退回状态和附件引用不能由旧版校验器完整读取，产生新版数据后如需回退，应先备份完整持久目录，再使用兼容新记录结构的版本；不要通过恢复旧数据来强行启动旧代码。

向同事分享 URL 即可访问已配置的服务器，不需给他们 `.env` 或 API Key。服务器私有配置只由服务端使用；本地 `.env.deploy` 中的 SSH 密码不上传，已配置 API Key 也不会出现在页面资源或业务记录中。

业务数据不进入 Git、代码发布包或离线 HTML。需要迁移服务器或离线备份时，可在空闲时停止应用，将持久目录复制到 root 私有备份目录后恢复运行。下面的复制步骤保留权限和目录结构，不涉及环境文件：

```sh
install -d -m 0700 /root/anzhen-fde-backups
systemctl stop anzhen-fde
cp -a /var/lib/anzhen-fde "/root/anzhen-fde-backups/data-$(date -u +%Y%m%dT%H%M%SZ)"
systemctl start anzhen-fde
curl --fail http://127.0.0.1:4173/api/health
```

备份副本仍含业务记录，应保留私有权限。恢复数据前先停服务、保留当前数据副本，再恢复经核对的备份并确认 `anzhen:anzhen` 所有权；恢复后重新检查页面记录。此处是人工备份方法，不代表已配置定时备份或验证过灾难恢复。

## 公网入口与宝塔 Nginx

当前已新增独立配置 `/www/server/panel/vhost/nginx/anzhen-fde.conf`，没有替换默认站点或其他宝塔配置。此服务器由现有宝塔 Nginx 提供代理，当前 systemd 生成的 `nginx.service` 可通过原 SysV 脚本重载它。修改配置后执行：

```sh
nginx -t && systemctl reload nginx
```

只有配置校验成功才重载 Nginx。迁移至其他服务器时，先根据 `nginx -T` 确定实际 include 目录和已有站点归属，再把 `deploy/nginx.conf.example` 作为新站点安装；不要照搬另一台机器的配置路径或覆盖已有站点。阿里云安全组和主机防火墙需放行实际使用的 Web 端口；4173 无需对公网开放。SSH 端口继续按已有管理要求控制。

本站 80 端口在 `location /` 内返回 HTTPS 重定向，同时保留以下独立验证路径。不要将重定向移回 server 级，否则可能先于 challenge 路由执行，影响续期：

```nginx
location ^~ /.well-known/acme-challenge/ {
    root /var/www/anzhen-acme;
    try_files $uri =404;
}

location / {
    return 301 https://8.147.71.90$request_uri;
}
```

443 端口使用 `/etc/letsencrypt/live/8.147.71.90/fullchain.pem` 与对应私钥，由 Certbot 更新链接；不要把证书或私钥复制到 Git。未来更换为域名时，应申请对应证书，并将 `PUBLIC_ORIGIN` 改为准确的 `https://域名` 后重启应用。Nginx 继续传递原始 Host、Origin，并设置 `X-Forwarded-Proto $scheme`。应用按明确配置的公开地址检查请求，不通过伪造为 localhost 的 Host 绕过来源检查。没有账号控制时，所有能访问公开地址的人也能调用 AI 接口；需要限制范围时应在网关层设置访问控制，并测试浏览器与健康检查行为。

## HTTPS 证书续期

2026-10-15 发现旧 IP 证书已于北京时间 2026-09-27 09:10:22 过期。此前 Certbot 使用 `standalone`，未发现自动续期 timer、cron 或 hooks。本站已改为不停止 Nginx 的 webroot 验证，续期配置为 `/etc/letsencrypt/renewal/8.147.71.90.conf`，保留原正式 CA、账号、`shortlived` 与 ECDSA。成功部署 hook 为 `/usr/bin/systemctl reload nginx`。

本轮使用 `/opt/certbot/bin/certbot` 5.8.0 完成正式续期。`reconfigure` 的 staging 验证两次读取超时，未改写原配置；随后对已过期证书执行 `renew` 并传入 webroot 与 deploy-hook，正式 CA 签发成功，Certbot 保存了新的续期参数。新证书当次有效期为 **2026-10-15 11:53:15 至 2026-10-22 03:53:14（北京时间）**；后续有效期以实时检查为准。

专用单元位于 `/etc/systemd/system/anzhen-cert-renew.service` 与 `/etc/systemd/system/anzhen-cert-renew.timer`，已启用开机激活。timer 每日服务器本地时间 00:00、12:00 运行，`RandomizedDelaySec=15min`、`Persistent=true`；只检查这张证书，未到续期窗口时正常退出。service 使用 `--no-random-sleep-on-renew`，避免与 timer 的随机延迟叠加；成功续期才执行 reload hook。

```sh
systemctl is-enabled anzhen-cert-renew.timer
systemctl list-timers anzhen-cert-renew.timer --no-pager
systemctl start anzhen-cert-renew.service
systemctl show anzhen-cert-renew.service -p Result -p ExecMainStatus
journalctl -u anzhen-cert-renew.service -n 50 --no-pager
openssl x509 -in /etc/letsencrypt/live/8.147.71.90/fullchain.pem -noout -dates
curl --fail https://8.147.71.90/api/health
```

2026-10-15 验证：随机 HTTP challenge 返回 `200` 且内容一致，删除后为 `404`，普通 HTTP 仍为 `301`；`nginx -t` 通过，外部 HTTPS 在正常信任校验下返回健康状态。证书签发后的 `nginx.service` journal 记录 12:51:48 reload 成功，`ReloadResult=success`；专用续期服务手动运行 `Result=success`、`ExecMainStatus=0`，timer 为 `enabled/active`。该手动检查未再次签发尚未到期的新证书；未来自动触发结果需查看 timer 与 journal。

本轮改动前的站点及续期配置保存在 `/root/anzhen-private-backups/tls-webroot-20261015-044428/`，目录权限 `0700`、文件 `0600`。443 站点块与备份完全一致；未停止 Nginx，未修改应用环境文件或业务数据。应用发布安装器不负责安装或更新证书 timer，迁移主机时需单独配置并验证证书续期，不能只迁移应用源码。

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
curl --fail --resolve 8.147.71.90:443:127.0.0.1 https://8.147.71.90/api/health
journalctl -u anzhen-fde -n 60 --no-pager
```

健康端点应返回 `status: ok` 与 `service: anzhen-referral-workspace`。它不调用模型，不代表 API Key 或模型网络已验证。再从外部浏览器访问 `https://8.147.71.90`，检查首页三个入口、医生照片、一次匹配和一次问答；图片识别和紧急通知整理分别进行少量真实请求验证。核对异常来源请求被拒绝，`.env` 和源码配置文件无法通过公开入口读取。不要忽略浏览器证书警告或用跳过证书验证的请求作为 HTTPS 验收结果。

常用操作：

```sh
systemctl restart anzhen-fde
systemctl stop anzhen-fde
systemctl start anzhen-fde
journalctl -u anzhen-fde -f
```

后续发布上传新的已检查版本，再运行安装器即可。它在端口被其他进程占用时停止，不杀掉无关服务；切换版本后的本机健康检查失败会恢复上一版链接和服务文件。安装器不会删除历史版本、持久业务目录或备份，不会更新环境文件内容，不会安装自动更新 Webhook。代码回滚不撤销已经保存的业务变更。进程重启会中断正在执行的 AI 请求，选择空闲时发布即可；当前方案是单实例部署，不提供零停机切换。

回滚失败时，先查看日志和 `/opt/anzhen-fde/current`，不要盲目重复安装。恢复后仍需重新验证 Nginx、公网访问与一次 AI 请求；本机健康检查通过不等于整个公网链路通过。
