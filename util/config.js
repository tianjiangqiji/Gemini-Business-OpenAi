const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const CONFIG_PATH = path.resolve(__dirname, "../temp-mail.yaml");

function ensureConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`配置文件缺失: ${CONFIG_PATH}`);
  }
}

function normalizeLineEndings(content) {
  return content.replace(/\r?\n/g, "\r\n");
}

function loadRawConfig() {
  ensureConfigFile();
  const raw = yaml.load(fs.readFileSync(CONFIG_PATH, "utf8")) || {};

  if (!raw.credentials) {
    raw.credentials = { account: "", password: "" };
  }

  if (!raw.accounts) {
    raw.accounts = {
      parent: {
        email: "",
        accountId: null,
        name: "",
        status: null,
        latestEmailTime: "",
        createTime: "",
      },
      children: [],
      lastUpdated: "",
    };
  } else {
    raw.accounts.parent = raw.accounts.parent || {
      email: "",
      accountId: null,
      name: "",
      status: null,
      latestEmailTime: "",
      createTime: "",
    };
    raw.accounts.children = raw.accounts.children || [];
    raw.accounts.lastUpdated = raw.accounts.lastUpdated || "";
  }

  return raw;
}

function resolveLoginEmail(account, defaultDomain) {
  if (!defaultDomain) {
    return account;
  }

  return account.includes("@") ? account : `${account}${defaultDomain}`;
}

function getCredentials() {
  const config = loadRawConfig();
  const { account, password } = config.credentials;
  const defaultDomain = config.defaultDomain || "@sohua.cc";
  const emailApiUrl = config.emailApiUrl || "https://mail.sohua.cc";
  const timezone = config.timezone || "UTC";

  if (!account || !password) {
    throw new Error("请在 temp-mail.yaml 中填写 account 与 password 字段后再运行");
  }

  return {
    account,
    password,
    defaultDomain,
    emailApiUrl,
    timezone,
    loginEmail: resolveLoginEmail(account, defaultDomain),
  };
}

function getStoredAccounts() {
  const config = loadRawConfig();
  return config.accounts;
}

function persistAccountsSnapshot({ parent, children }) {
  const config = loadRawConfig();
  config.accounts = {
    parent,
    children,
    lastUpdated: new Date().toISOString(),
  };

  const serialized = yaml.dump(config, { lineWidth: -1 });
  fs.writeFileSync(CONFIG_PATH, normalizeLineEndings(serialized), "utf8");
}

module.exports = {
  getCredentials,
  getStoredAccounts,
  persistAccountsSnapshot,
};
