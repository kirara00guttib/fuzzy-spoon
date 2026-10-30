# 上线到 Cloudflare（任何网络都能打开）

本地那套是 `node server/index.mjs`，只在你电脑上跑。要让手机在外面也能开，有两个东西：

| | 本地版 | 云端版 |
| --- | --- | --- |
| 代码 | `server/*.mjs`（Node） | `worker/*.mjs`（Cloudflare Workers） |
| 文字数据 | `data/store.json` | **KV** 里的一个键 |
| 照片 | `data/uploads/` 或 R2 | **R2**（预签名直传） |
| 前端 | `public/`（一模一样，一行没改） | 同左 |

两个版本的接口完全一致，所以 `public/` 里没有任何分叉。

---

## 一、把代码推到 GitHub

**方式 A：让我推（推荐，不用装 git）**

```bash
node tools/push-to-github.mjs --repo 你的用户名/仓库名 --token ghp_xxxxxx
```

- 仓库先在 GitHub 上建好（空仓库就行，不要勾 README）
- 令牌：GitHub → Settings → Developer settings → Personal access tokens
  - 经典令牌勾 **repo**
  - 细粒度令牌给目标仓库 **Contents: Read and write**
- 想先看看会推哪些文件：加 `--dry`

**方式 B：你自己用 git**

```bash
git init && git add -A && git commit -m "日记本"
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

`.gitignore` 已经排除了 `.env`、`data/`、`.dev.vars`、`.wrangler/`、`.preview/`、`backups/`，所以密码和数据不会进仓库。

---

## 二、部署到 Cloudflare Workers

### 0. 登录（只需一次）

```bash
npx wrangler login
```

会弹浏览器，点 **Allow**。

### 1. 准备 R2（照片存储）

1. Cloudflare 控制台 → **R2** → **Create bucket**，名字例如 `riji-photos`（保持私密，不要开 Public access）
2. **R2 → Manage R2 API Tokens → Create API token**
   - 权限：**Object Read & Write**
   - 资源：只选这个桶
   - 建好后记下 `Access Key ID`、`Secret Access Key`，以及页面上的 `Account ID`

### 2. 把凭据填进 `.env`

```ini
USER1_PASS=miaomiaomiao@lxj
USER2_PASS=AaA@neko
AUTH_SECRET=随便一串长随机字符

R2_ACCOUNT_ID=你的账户ID
R2_ACCESS_KEY_ID=你的AccessKeyID
R2_SECRET_ACCESS_KEY=你的SecretAccessKey
R2_BUCKET=riji-photos
```

> `.env` 只在你本机，`tools/deploy-cloudflare.mjs` 会把它们写成 Worker 的 Secret（加密存在 Cloudflare 侧），不会进仓库、不会进前端。

### 3. 一键部署

```bash
node tools/deploy-cloudflare.mjs --check   # 先检查登录和 .env 齐不齐
node tools/deploy-cloudflare.mjs           # 真正部署
```

它会依次做：

1. `whoami` 确认已登录
2. 创建 KV 命名空间 `riji-store`，把 id 写回 `wrangler.toml`
3. 创建 R2 桶（已存在就跳过）
4. 把 7 个密钥写成 Worker Secret
5. `wrangler deploy`，最后打印你的 `https://riji.xxx.workers.dev`

### 4. 给桶配 CORS（必须，否则照片传不上去）

R2 → 你的桶 → **Settings → CORS Policy**：

```json
[
  {
    "AllowedOrigins": [
      "https://riji.你的账号.workers.dev",
      "http://127.0.0.1:5173"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

（以后绑了自定义域名，把那个域名也加进去。）

### 5. 验证

打开 `https://你的域名/api/health`，应该看到：

```json
{"ok":true,"service":"riji","runtime":"cloudflare-worker","storage":"r2","kv":true}
```

`storage` 必须是 `r2` —— 如果是 `unconfigured`，说明 R2 的三样密钥没写进去，重跑第 3 步。

然后打开首页登录，传一张照片试试。

---

## 三、绑一个好记的域名（可选）

Cloudflare → Workers → 你的 Worker → **Settings → Domains & Routes → Add → Custom domain**。
前提是这个域名已经托管在同一个 Cloudflare 账号下。绑好后记得把域名加进 R2 的 CORS。

---

## 四、以后更新

```bash
node tools/push-to-github.mjs --repo 用户名/仓库名 --token ghp_xxx   # 代码同步到 GitHub
node tools/deploy-cloudflare.mjs                                    # 重新部署
```

改密码就改 `.env` 里 `USER1_PASS` / `USER2_PASS`，再跑一次 `deploy-cloudflare.mjs`。

---

## 五、云端版的注意事项

- **KV 写入限制**：同一个键每秒最多 1 次写。你们两个人用完全够，但别写脚本狂刷接口。
- **免费额度**：Workers 每天 10 万次请求、KV 读 10 万/天 + 写 1000/天、R2 10 GB 存储 —— 这个站远远用不到上限。
- **备份**：云端数据在 KV 里。要备份就跑：

  ```bash
  npx wrangler kv key get --binding=STORE db > backup-$(date +%F).json
  ```

  照片在 R2，可以给桶开 Object Versioning，或用 `rclone sync` 拉回本地。
- **会话**：Cookie 是 HttpOnly + Secure + SameSite=Strict，HTTPS 下才会下发（Workers 默认就是 https）。
- **想换回本机版**：`node server/index.mjs` 照旧能用，数据在 `data/`，两边互不影响。

---

## 六、只想临时手机看看（不上线的偷懒办法）

不用部署，在电脑上开一条 Cloudflare 隧道就行：

```bash
npx cloudflared tunnel --url http://127.0.0.1:5173
```

它会打印一个 `https://xxx.trycloudflare.com` 地址，任何网络都能打开。缺点：电脑要一直开着、地址每次都会变。
