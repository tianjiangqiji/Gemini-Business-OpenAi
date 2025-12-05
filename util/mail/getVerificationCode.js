const { selectAccount, prompt } = require("../selectAccount");
const { getCredentials } = require("../config");

const EMAIL_LIST_URL = "https://mail.sohua.cc/api/email/list";
const { timezone = "UTC" } = getCredentials();

/**
 * 确保 fetch API 可用
 */
function ensureFetchAvailable() {
    if (typeof globalThis.fetch !== "function") {
        throw new Error("当前 Node 版本不支持全局 fetch，请使用 Node 18+ 或自行 polyfill fetch");
    }
}

/**
 * 判断时间是否在指定分钟内
 * @param {string|number|Date} time
 * @param {number} minutes
 * @returns {boolean}
 */
function normalizeTimestamp(time, tz = "UTC") {
    const raw = Number(time);
    if (!Number.isNaN(raw)) {
        // 如果是秒级时间戳，转换为毫秒
        if (raw < 1e12) return raw * 1000;
        return raw;
    }

    const str = String(time || "").trim();

    // 已包含时区信息，直接解析
    if (/(\+|-)\d{2}:?\d{2}|Z$/i.test(str)) {
        return new Date(str).getTime();
    }

    // 解析配置的时区，例如 UTC、UTC+08:00、UTC-05:30
    const match = /^UTC(?:(\+|-)(\d{2})(?::?(\d{2}))?)?$/.exec(tz);
    if (!match) return new Date(str).getTime(); // 无法识别时区则按环境解析

    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    const offsetMinutes = sign * (hours * 60 + minutes);

    // 将本地时间字符串附加时区偏移
    const isoLike = str.replace(" ", "T");
    const offsetStr = `${sign === 1 ? "+" : "-"}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    return new Date(`${isoLike}${offsetStr}`).getTime();
}

function isWithinMinutes(time, minutes = 3) {
    const ts = normalizeTimestamp(time, timezone);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts <= minutes * 60 * 1000;
}

/**
 * 从邮件主题中提取验证码
 * @param {string} subject - 邮件主题
 * @returns {string|null} 验证码或 null
 */
function extractVerificationCode(subject) {
    // 匹配 "你的 ChatGPT 代码为 XXXXXX" 格式
    const match = subject.match(/(?:代码为|code is|código es)\s*(\d{6})/i);
    return match ? match[1] : null;
}

/**
 * 获取指定账号的最新邮件列表
 * @param {string} token - 已登录的会话令牌
 * @param {number} accountId - 账号ID
 * @param {number} size - 获取邮件数量（默认5）
 * @returns {Promise<Object>} 邮件列表数据
 */
async function fetchEmailList(token, accountId, size = 5) {
    ensureFetchAvailable();

    const url = `${EMAIL_LIST_URL}?accountId=${accountId}&emailId=0&timeSort=0&size=${size}&type=0`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Authorization": token,
        },
    });

    if (!response.ok) {
        throw new Error(`获取邮件列表失败，HTTP 状态码 ${response.status}`);
    }

    const payloadText = await response.text();
    let payload;
    try {
        payload = JSON.parse(payloadText);
    } catch (error) {
        throw new Error(`邮件列表响应无法解析为 JSON: ${error.message}`);
    }

    if (payload.code !== 200) {
        throw new Error(`获取邮件列表失败: ${payload.message || "未知错误"}`);
    }

    return payload.data;
}

/**
 * 查找最新的 ChatGPT 验证码邮件
 * @param {Array} emailList - 邮件列表
 * @returns {Object|null} 包含验证码和时间的对象，或 null
 */
function findLatestVerificationCode(emailList) {
    if (!emailList || emailList.length === 0) {
        return null;
    }

    // 遍历邮件列表，查找包含验证码的邮件
    for (const email of emailList) {
        const code = extractVerificationCode(email.subject);
        if (code) {
            return {
                code: code,
                time: email.createTime,
                subject: email.subject,
                from: email.name || email.sendEmail,
            };
        }
    }

    return null;
}

/**
 * 获取最新登录验证码（主函数）
 * @param {string} token - 已登录的会话令牌
 * @param {Object} rl - readline 接口（可选）
 */
async function getVerificationCode(token, rl = null) {
    if (!token) {
        throw new Error("缺少会话令牌，请确保已登录");
    }

    if (!rl) {
        throw new Error("缺少 readline 接口");
    }

    console.log("\n获取最新登录验证码");
    console.log("=".repeat(50));

    // 让用户选择账号
    const selectedAccount = await selectAccount(token, rl, true);

    if (!selectedAccount) {
        return; // 用户取消了操作
    }

    console.log(`\n正在获取 ${selectedAccount.email} 的最新邮件...`);

    const maxRetries = 5;
    const retryDelay = 10000; // 10 秒

    for (let i = 0; i < maxRetries; i++) {
        console.log(`\n⏳ 正在获取验证码... (尝试 ${i + 1}/${maxRetries})`);

        // 获取邮件列表
        const emailData = await fetchEmailList(token, selectedAccount.accountId, 10);

        if (!emailData.list || emailData.list.length === 0) {
            console.log("❌ 该账号暂无邮件。");
        } else {
            const sortedList = [...emailData.list].sort((a, b) => normalizeTimestamp(b.createTime) - normalizeTimestamp(a.createTime));
            const latestMail = sortedList[0];
            const latestMailTime = latestMail?.createTime;
            const latestTs = normalizeTimestamp(latestMailTime);
            console.log(`ℹ️  最新邮件时间: ${latestMailTime} (ts=${latestTs})，距离现在 ${(Date.now() - latestTs) / 1000}s`);

            if (Number.isNaN(latestTs)) {
                console.log("⚠️  最新邮件时间无法解析，10秒后重试...");
            } else if (!isWithinMinutes(latestMailTime, 3)) {
                console.log("⚠️  最新邮件不在3分钟内，可能验证码尚未送达，10秒后重试...");
            } else {
                // 查找验证码
                const verificationInfo = findLatestVerificationCode(sortedList);

                if (!verificationInfo) {
                    console.log("❌ 未找到 ChatGPT 验证码邮件，10秒后重试...");
                } else if (!isWithinMinutes(verificationInfo.time, 3)) {                    
                    console.log(`⚠️  找到的验证码邮件时间: ${verificationInfo.time} (ts=${normalizeTimestamp(verificationInfo.time)}) 不是3分钟内的，10秒后重试...`);
                } else {
                    // 显示验证码信息
                    console.log("\n✓ 找到验证码！");
                    console.log("=".repeat(50));
                    console.log(`📧 验证码: ${verificationInfo.code}`);
                    console.log(`⏰ 接收时间: ${verificationInfo.time}`);
                    console.log(`📨 发件人: ${verificationInfo.from}`);
                    console.log(`📝 主题: ${verificationInfo.subject}`);
                    console.log("=".repeat(50));

                    await prompt("\n按回车键返回主菜单...", rl);
                    return;
                }
            }
        }

        if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    console.log("\n❌ 未能在5次重试内获取到3分钟内的验证码邮件。");
    await prompt("\n按回车键返回主菜单...", rl);
}

module.exports = getVerificationCode;
