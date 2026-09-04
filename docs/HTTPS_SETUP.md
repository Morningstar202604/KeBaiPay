# KeBaiPay HTTPS 部署指南

> 本文档提供三种 HTTPS 配置方案，适用于 Docker Compose 和裸机部署。

## 目录

- [方案一：Nginx + Certbot（推荐）](#方案一nginx--certbot推荐)
- [方案二：Caddy（最简单）](#方案二caddy最简单)
- [方案三：Cloudflare Tunnel（无需公网 IP）](#方案三cloudflare-tunnel无需公网-ip)
- [端口与域名规划](#端口与域名规划)
- [前置检查清单](#前置检查清单)

---

## 方案一：Nginx + Certbot（推荐）

### 适用场景

- 拥有公网 IP 和域名
- 需要精细控制 TLS 参数
- 生产环境标准部署

### 1. 安装 Nginx 和 Certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. 配置 Nginx 反向代理

创建配置文件 `/etc/nginx/sites-available/kebaipay`：

```nginx
upstream kebaipay_backend {
    server 127.0.0.1:3001;
    keepalive 64;
}

# HTTP → HTTPS 强制跳转
server {
    listen 80;
    listen [::]:80;
    server_name api.your-domain.com pay.your-domain.com;
    
    # ACME 验证路径（Certbot 需要）
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://$host$request_uri;
    }
}

# API 主站
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.your-domain.com;
    
    # TLS 证书
    ssl_certificate     /etc/letsencrypt/live/api.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    
    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;
    
    # 安全头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:;" always;
    
    access_log /var/log/nginx/kebaipay-api-access.log;
    error_log  /var/log/nginx/kebaipay-api-error.log;
    
    client_max_body_size 2m;
    client_body_timeout 60s;
    client_header_timeout 60s;
    send_timeout 60s;
    
    # 健康检查（不记日志）
    location ~ ^/health {
        proxy_pass http://kebaipay_backend;
        access_log off;
        proxy_ignore_client_abort off;
    }
    
    # Prometheus 指标（仅内网）
    location = /metrics {
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny  all;
        proxy_pass http://kebaipay_backend;
        access_log off;
    }
    
    # API 反向代理
    location / {
        proxy_pass http://kebaipay_backend;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout    60s;
        proxy_connect_timeout 10s;
        proxy_send_timeout    60s;
        proxy_buffering       on;
        proxy_buffer_size     4k;
        proxy_buffers         8 4k;
    }
}

# 收银台前端（静态文件）
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name pay.your-domain.com;
    
    ssl_certificate     /etc/letsencrypt/live/api.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    
    # 前端静态文件路径（部署后修改为实际路径）
    root /opt/kebaipay/web/dist;
    index index.html;
    
    # SPA 路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # API 代理到后端
    location /api/ {
        proxy_pass http://kebaipay_backend/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
}
```

### 3. 启用配置并申请证书

```bash
# 创建 ACME 验证目录
sudo mkdir -p /var/www/certbot

# 启用站点
sudo ln -s /etc/nginx/sites-available/kebaipay /etc/nginx/sites-enabled/
sudo nginx -t

# 测试配置无误后重载
sudo systemctl reload nginx

# 申请 Let's Encrypt 证书（首次需要）
sudo certbot --nginx -d api.your-domain.com -d pay.your-domain.com \
  --non-interactive --agree-tos -m admin@your-domain.com \
  --redirect --staple-ocsp

# 测试自动续期
sudo certbot renew --dry-run
```

### 4. 配置 .env 环境变量

```bash
# 更新 .env 文件
NODE_ENV="production"
PORT=3001

# 配置生产域名（替换为实际域名）
CORS_ORIGINS="https://your-domain.com,https://pay.your-domain.com,https://api.your-domain.com"
RECHARGE_NOTIFY_URL="https://api.your-domain.com/webhooks/recharge"
CASHIER_BASE_URL="https://pay.your-domain.com"
```

### 5. 重启应用

```bash
# Docker Compose 模式
docker compose restart app

# 裸机 + PM2 模式
pm2 restart kebaipay
```

### 6. 验证部署

```bash
# 测试 HTTPS 访问
curl -I https://api.your-domain.com/health
curl -I https://pay.your-domain.com

# 检查 TLS 证书
echo | openssl s_client -connect api.your-domain.com:443 -servername api.your-domain.com 2>/dev/null | openssl x509 -noout -dates -subject

# 检查 HSTS
curl -I https://api.your-domain.com | grep -i strict
```

---

## 方案二：Caddy（最简单）

### 适用场景

- 快速部署，自动 HTTPS
- 不想手动管理证书
- 个人项目或小型生产环境

### 1. 安装 Caddy

```bash
# Ubuntu / Debian
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### 2. 创建 Caddyfile

创建 `/etc/caddy/Caddyfile`：

```caddyfile
api.your-domain.com {
    reverse_proxy localhost:3001
    
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
    
    encode gzip zstd
    file_server
}

pay.your-domain.com {
    root * /opt/kebaipay/web/dist
    file_server
    
    route /api/* {
        reverse_proxy localhost:3001
    }
    
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    }
    
    encode gzip zstd
    
    rewrite * {path} {path}/
    try_files {path} {path}/ /index.html
}
```

### 3. 启动 Caddy

```bash
sudo systemctl daemon-reload
sudo systemctl enable caddy
sudo systemctl start caddy

# 查看状态
sudo systemctl status caddy
sudo journalctl -u caddy -f
```

### 4. 验证

```bash
# Caddy 会自动申请 Let's Encrypt 证书
curl -I https://api.your-domain.com/health
curl -I https://pay.your-domain.com
```

---

## 方案三：Cloudflare Tunnel（无需公网 IP）

### 适用场景

- 没有公网 IP
- 使用 Cloudflare CDN
- 需要 DDoS 防护

### 1. 安装 Cloudflared

```bash
# Ubuntu / Debian
wget -qO - https://release.artifacts.cloudflare.com/cloudflare-main.gpg | sudo apt-key add -
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://release.artifacts.cloudflare.com/cloudflare-main/debian bookworm main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared
```

### 2. 登录并创建隧道

```bash
# 登录 Cloudflare（会打开浏览器授权）
cloudflared tunnel login

# 创建隧道
cloudflared tunnel create kebaipay

# 记录 Tunnel ID（后续配置需要）
# cloudflared tunnel list
```

### 3. 配置隧道

创建 `/etc/cloudflared/config.yml`：

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /root/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: api.your-domain.com
    service: http://localhost:3001
  - hostname: pay.your-domain.com
    service: http://localhost:3001
    # 收银台前端
    # service: file:///opt/kebaipay/web/dist
  - service: http_status:404
```

### 4. 配置 DNS

在 Cloudflare DNS 控制台添加 CNAME 记录：

```
api  →  <tunnel-id>.cfargotunnel.com
pay  →  <tunnel-id>.cfargotunnel.com
```

### 5. 启动隧道

```bash
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

# 查看状态
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
```

---

## 端口与域名规划

### 推荐域名结构

| 域名 | 用途 | 说明 |
|------|------|------|
| `api.your-domain.com` | API 服务 | 后端接口，支付回调 |
| `pay.your-domain.com` | 收银台 | 用户支付页面 |
| `your-domain.com` | 商户后台 | 商户管理界面 |
| `admin.your-domain.com` | 管理后台 | 运营管理界面 |

### 端口映射

| 服务 | 内部端口 | 外部端口 | 协议 |
|------|---------|---------|------|
| API 后端 | 3001 | 443 (HTTPS) | HTTPS |
| 收银台前端 | - | 443 (HTTPS) | HTTPS |
| 健康检查 | 3001 | 443 (HTTPS) | HTTPS |

---

## 前置检查清单

在配置 HTTPS 前，确认以下条件：

- [ ] 已购买域名并配置 DNS
- [ ] 域名已解析到服务器 IP（A 记录）
- [ ] 服务器开放 80 和 443 端口
- [ ] 防火墙允许 HTTP/HTTPS 流量
- [ ] `.env` 中的域名已更新为生产域名
- [ ] `RECHARGE_NOTIFY_URL` 指向可公网访问的 HTTPS 地址
- [ ] 微信支付/支付宝的回调地址已更新为生产域名

---

## 证书续期

### Nginx 方案

Certbot 会自动续期，确认 cron 任务存在：

```bash
sudo systemctl status certbot.timer
sudo systemctl enable --now certbot.timer
```

手动测试续期：

```bash
sudo certbot renew --dry-run
```

### Caddy 方案

Caddy 自动管理证书，无需手动续期。

### Cloudflare 方案

Cloudflare 自动管理证书，无需手动操作。
