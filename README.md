# Gemini Business & OpenAI 临时邮箱工具

**项目简介**
- **说明**: 这是一个以 Node.js + Puppeteer 为基础的临时邮箱自动化工具，用于创建/管理临时邮箱并配合 Gemini/业务接口使用。
代码会唤起带有 UI 界面的浏览器，因此请在图形化系统使用
**前提条件**
- **Node.js**: 推荐 Node.js 18+。在 Windows 下请使用 PowerShell (`pwsh.exe`) 或 CMD。
- **依赖安装**: 项目使用 `puppeteer`（默认会下载 Chromium），以及 `axios`、`js-yaml` 等。
- **其他项目支持**: 配合 [cloud-mail](https://github.com/maillab/cloud-mail) 邮箱系统使用和 [business-gemini-pool](https://github.com/ddcat666/business-gemini-pool) 2API 系统。


**快速开始**
- **安装依赖**:

```powershell
npm install
```

- **运行程序**:

```powershell
npm start
```

**配置说明**
- 本项目使用 YAML 配置文件，主要有两个配置文件（项目根目录）：
  - `temp-mail.yaml`：临时邮箱相关配置（必需）
  - `gemini-mail.yaml`：与 Gemini/池相关的配置（按需）

- `temp-mail.yaml` 关键字段（示例）:

```yaml
credentials:
  account: your_account_here
  password: your_password_here
defaultDomain: '@example.com'
emailApiUrl: 'https://mail.example.com'
timezone: UTC # 邮件服务器所在位置时区，例如 UTC、UTC+08:00；（大陆服务器为UTC+08:00）
```

  - **说明**: `util/config.js` 会读取 `temp-mail.yaml`，并在 `credentials.account` 或 `credentials.password` 为空时抛出错误：
    > 请在 temp-mail.yaml 中填写 account 与 password 字段后再运行

- `gemini-mail.yaml` 示例（视业务需要）:

```yaml
poolApiUrl: https://example-pool.api
password: your_pool_password
```

**常见问题与排查**
- Puppeteer 无法启动或报错：
  - 默认情况下 Puppeteer 会下载 Chromium；如果要使用本地已安装的 Chrome，请在运行前设置环境变量（PowerShell）：

```powershell
$env:PUPPETEER_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm start
```
## 致谢：
配套的邮箱系统是：[cloud-mail](https://github.com/maillab/cloud-mail)

配套的2API系统是：[business-gemini-pool](https://github.com/ddcat666/business-gemini-pool)
