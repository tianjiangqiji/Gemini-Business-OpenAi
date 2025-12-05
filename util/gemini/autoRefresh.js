const {
    getGeminiParentAccount,
    getGeminiChildrenAccounts,
    updateChildToken,
} = require("./geminiConfig");
const { getCredentials } = require("../config");

// 从配置文件获取邮箱 API URL
const { emailApiUrl, timezone = "UTC" } = getCredentials();
const EMAIL_LIST_URL = `${emailApiUrl}/api/email/list`;

/**
 * 确保 fetch API 可用
 */
function ensureFetchAvailable() {
    if (typeof globalThis.fetch !== "function") {
        throw new Error("当前 Node 版本不支持全局 fetch，请使用 Node 18+ 或自行 polyfill fetch");
    }
}

function promptInput(question, rl) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
    });
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
 * 从邮件文本中提取 Gemini 验证码
 * @param {string} text - 邮件正文
 * @returns {string|null} 验证码或 null
 */
function extractGeminiVerificationCode(text) {
    // 匹配 "您的一次性验证码为：\n\nXXXXXX" 格式
    const match = text.match(/您的一次性验证码为：\s*\n\s*\n\s*([A-Z0-9]{6})/i);
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
 * 查找最新的 Gemini 验证码邮件
 * @param {Array} emailList - 邮件列表
 * @returns {string|null} 验证码或 null
 */
function findGeminiVerificationCode(emailList) {
    if (!emailList || emailList.length === 0) {
        return null;
    }

    // 遍历邮件列表，查找 Gemini Business 验证码邮件
    for (const email of emailList) {
        if (email.subject === "Gemini Business 验证码") {
            const code = extractGeminiVerificationCode(email.text);
            if (code) {
                return code;
            }
        }
    }

    return null;
}

/**
 * 等待并获取 Gemini 验证码（最多重试5次，每次等待5秒）
 * @param {string} token - 已登录的会话令牌
 * @param {number} accountId - 账号ID
 * @returns {Promise<string>} 验证码
 */
async function waitForGeminiVerificationCode(token, accountId) {
    const maxRetries = 5;
    const retryDelay = 10000; // 10秒

    for (let i = 0; i < maxRetries; i++) {
        console.log(`   ⏳ 正在获取验证码... (尝试 ${i + 1}/${maxRetries})`);
        
        try {
            const emailData = await fetchEmailList(token, accountId, 5);
            
            if (emailData.list && emailData.list.length > 0) {
                const sortedList = [...emailData.list].sort((a, b) => normalizeTimestamp(b.createTime) - normalizeTimestamp(a.createTime));
                const latestMail = sortedList[0];
                const latestMailTime = latestMail?.createTime;
                const latestTs = normalizeTimestamp(latestMailTime);
                console.log(`   ℹ️  最新邮件时间: ${latestMailTime} (ts=${latestTs})，距离现在 ${(Date.now() - latestTs) / 1000}s，主题: ${latestMail?.subject}`);

                if (Number.isNaN(latestTs)) {
                    console.log("   ⚠️  最新邮件时间无法解析，10秒后重试...");
                } else if (!isWithinMinutes(latestMailTime, 3)) {
                    console.log("   ⚠️  最新邮件不在3分钟内，可能验证码尚未送达，10秒后重试...");
                } else {
                    const code = findGeminiVerificationCode(sortedList);
                    if (code) {
                        // 找到验证码后再确认其时间仍在3分钟内
                        const matchedMail = sortedList.find(mail => mail.subject === "Gemini Business 验证码" && extractGeminiVerificationCode(mail.text));
                        if (matchedMail && isWithinMinutes(matchedMail.createTime, 3)) {
                            console.log(`   ✓ 成功获取验证码: ${code}`);
                            return code;
                        } else {
                            console.log(`   ⚠️  找到的验证码邮件时间: ${matchedMail?.createTime} (ts=${normalizeTimestamp(matchedMail?.createTime)}) 不是3分钟内的，10秒后重试...`);
                        }
                    } else {
                        console.log("   ❌ 未在3分钟内的邮件中找到 Gemini 验证码，10秒后重试...");
                    }
                }
            } else {
                console.log("   ❌ 邮件列表为空，10秒后重试...");
            }
        } catch (error) {
            console.log(`   ⚠️  获取邮件失败: ${error.message}`);
        }

        if (i < maxRetries - 1) {
            console.log(`   ⏳ 未找到符合条件的验证码，等待 10 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    throw new Error("未能在规定时间内获取到验证码");
}

/**
 * 检测当前登录的母号是否与 gemini-mail.yaml 中的母号一致
 * @param {string} currentLoginEmail - 当前登录的邮箱
 * @returns {boolean} 是否匹配
 */
function verifyParentAccount(currentLoginEmail) {
    const parentAccount = getGeminiParentAccount();

    if (!parentAccount || !parentAccount.email) {
        throw new Error("gemini-mail.yaml 中未找到母号信息");
    }

    const isMatch = parentAccount.email === currentLoginEmail;

    if (!isMatch) {
        console.log(`⚠️  母号不匹配！`);
        console.log(`   配置文件中的母号: ${parentAccount.email}`);
        console.log(`   当前登录的母号: ${currentLoginEmail}`);
    }

    return isMatch;
}

/**
 * 登录单个 Gemini 子号并获取 token
 * @param {Object} childAccount - 子号信息
 * @param {string} token - 已登录的会话令牌（用于获取邮件）
 * @returns {Promise<Object>} 返回包含 4 个 token 的对象
 */
async function loginGeminiChild(childAccount, token) {
    console.log(`\n🔄 正在登录子号: ${childAccount.email}`);
    console.log(`   账号ID: ${childAccount.accountId}`);
    console.log(`   邮箱: ${childAccount.email}`);

    const puppeteer = require('puppeteer');
    
    let browser;
    try {
        // 1. 启动浏览器
        console.log(`   ⏳ 启动浏览器...`);
        browser = await puppeteer.launch({
            headless: false, // 显示浏览器界面，方便调试
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // 2. 访问 Gemini 登录页面
        console.log(`   ⏳ 访问 Gemini 登录页面...`);
        await page.goto('https://auth.business.gemini.google/login?continueUrl=https://business.gemini.google/');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 3. 填入邮箱
        console.log(`   ⏳ 填入邮箱...`);
        const emailSelector = '#email-input';
        await page.waitForSelector(emailSelector);
        await page.type(emailSelector, childAccount.email);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 4. 点击下一步按钮
        console.log(`   ⏳ 点击下一步按钮...`);
        const nextButtonSelector = '#log-in-button';
        await page.click(nextButtonSelector);
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 5. 等待验证码输入框出现
        console.log(`   ⏳ 等待验证码输入框...`);
        const verificationCodeSelector = 'input[name="pinInput"]';
        await page.waitForSelector(verificationCodeSelector);
        
        // 6. 等待页面加载完毕，给邮件发送留出时间
        console.log(`   ⏳ 等待邮件发送（10秒）...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // 7. 自动从邮箱获取验证码
        console.log(`   ⏳ 正在从邮箱获取验证码...`);
        const verificationCode = await waitForGeminiVerificationCode(token, childAccount.accountId);

        // 8. 自动填入验证码
        console.log(`   ⏳ 填入验证码...`);
        // 先点击输入框聚焦
        await page.click(verificationCodeSelector);
        await new Promise(resolve => setTimeout(resolve, 500));
        // 清空输入框
        await page.evaluate((selector) => {
            document.querySelector(selector).value = '';
        }, verificationCodeSelector);
        // 使用 type 方法逐字输入
        await page.type(verificationCodeSelector, verificationCode, { delay: 100 });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 9. 点击验证按钮
        console.log(`   ⏳ 点击验证按钮...`);
        const verifyButtonSelector = 'button[aria-label="验证"]';
        await page.click(verifyButtonSelector);
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log(`   ✓ 验证完成，等待页面跳转...`);
        
        // 10. 等待页面跳转到 Gemini Business 主页（可能需要多次跳转）
        console.log(`   ⏳ 等待页面完全加载（最多60秒）...`);
        
        // 等待 URL 包含 /cid/ 路径（表示已经到达聊天页面）
        const maxWaitTime = 60000; // 60秒
        const startTime = Date.now();
        let currentUrl = page.url();
        
        while (!currentUrl.includes('/cid/') && (Date.now() - startTime) < maxWaitTime) {
            console.log(`      当前 URL: ${currentUrl}`);
            console.log(`      等待跳转到聊天页面...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            currentUrl = page.url();
        }
        
        // 再等待一段时间确保页面完全加载
        console.log(`   ⏳ 页面已跳转，等待完全加载（10秒）...`);
        await new Promise(resolve => setTimeout(resolve, 10000));

        // 11. 获取 4 个 token
        console.log(`   ⏳ 获取 token...`);
        
        // 获取所有 cookies
        const cookies = await page.cookies();
        
        // 从 cookies 中提取需要的值
        const secure_c_ses = cookies.find(c => c.name === '__Secure-C_SES')?.value || null;
        const host_c_oses = cookies.find(c => c.name === '__Host-C_OSES')?.value || '';
        
        // 从 URL 中提取 csesidx 和 team_id (config_id)
        currentUrl = page.url();
        const urlParams = new URLSearchParams(new URL(currentUrl).search);
        const csesidx = urlParams.get('csesidx') || null;
        
        // 从 URL 路径中提取 team_id (在 /cid/ 后面)
        const pathMatch = currentUrl.match(/\/cid\/([^/?]+)/);
        const team_id = pathMatch ? pathMatch[1] : null;

        // 验证是否获取到所有必需的 token
        if (!secure_c_ses || !csesidx || !team_id) {
            console.log(`   ⚠️  Token 获取不完整:`);
            console.log(`      secure_c_ses: ${secure_c_ses ? '✓' : '✗'}`);
            console.log(`      csesidx: ${csesidx ? '✓' : '✗'}`);
            console.log(`      team_id: ${team_id ? '✓' : '✗'}`);
            console.log(`      host_c_oses: ${host_c_oses ? '✓' : '✗'}`);
            console.log(`      当前 URL: ${currentUrl}`);
            throw new Error('Token 获取不完整，请检查登录流程');
        }

        const tokens = {
            csesidx: csesidx,
            host_c_oses: host_c_oses,
            secure_c_ses: secure_c_ses,
            team_id: team_id,
        };

        console.log(`   ✓ 登录成功，获取到 4 个 token`);
        console.log(`      csesidx: ${csesidx.substring(0, 20)}...`);
        console.log(`      team_id: ${team_id}`);
        console.log(`      secure_c_ses: ${secure_c_ses.substring(0, 20)}...`);
        console.log(`      host_c_oses: ${host_c_oses ? host_c_oses.substring(0, 20) + '...' : '(空)'}`);
        
        return tokens;

    } catch (error) {
        console.error(`   ❌ 登录过程出错: ${error.message}`);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * 仅登录单个 Gemini 子号用于临时在线使用（不获取 token，不自动关闭浏览器）
 * @param {Object} childAccount - 子号信息
 * @param {string} token - 已登录的会话令牌（用于获取邮件）
 * @param {Object} rl - readline 接口
 */
async function openGeminiChildInteractive(token, childAccount, rl) {
    if (!rl) {
        throw new Error("缺少 readline 接口");
    }

    console.log(`\n🔄 正在登录子号(临时在线): ${childAccount.email}`);
    const puppeteer = require("puppeteer");
    let browser;
    let success = false;

    try {
        console.log(`   ⏳ 启动浏览器...`);
        browser = await puppeteer.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            defaultViewport: null, // 不限制页面视口，方便用户完整使用
        });

        const page = await browser.newPage();

        console.log(`   ⏳ 访问 Gemini 登录页面...`);
        await page.goto("https://auth.business.gemini.google/login?continueUrl=https://business.gemini.google/");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        console.log(`   ⏳ 填入邮箱...`);
        const emailSelector = "#email-input";
        await page.waitForSelector(emailSelector);
        await page.type(emailSelector, childAccount.email);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        console.log(`   ⏳ 点击下一步按钮...`);
        const nextButtonSelector = "#log-in-button";
        await page.click(nextButtonSelector);
        await new Promise((resolve) => setTimeout(resolve, 3000));

        console.log(`   ⏳ 等待验证码输入框...`);
        const verificationCodeSelector = 'input[name="pinInput"]';
        await page.waitForSelector(verificationCodeSelector);

        console.log(`   ⏳ 等待邮件发送（10秒）...`);
        await new Promise((resolve) => setTimeout(resolve, 10000));

        console.log(`   ⏳ 正在从邮箱获取验证码...`);
        const verificationCode = await waitForGeminiVerificationCode(token, childAccount.accountId);

        console.log(`   ⏳ 填入验证码...`);
        await page.click(verificationCodeSelector);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await page.evaluate((selector) => {
            document.querySelector(selector).value = "";
        }, verificationCodeSelector);
        await page.type(verificationCodeSelector, verificationCode, { delay: 100 });
        await new Promise((resolve) => setTimeout(resolve, 1000));

        console.log(`   ⏳ 点击验证按钮...`);
        const verifyButtonSelector = 'button[aria-label="验证"]';
        await page.click(verifyButtonSelector);
        await new Promise((resolve) => setTimeout(resolve, 3000));

        console.log(`   ✓ 验证完成，等待页面跳转...`);
        const maxWaitTime = 60000;
        const startTime = Date.now();
        let currentUrl = page.url();
        while (!currentUrl.includes("/cid/") && Date.now() - startTime < maxWaitTime) {
            console.log(`      当前 URL: ${currentUrl}`);
            console.log(`      等待跳转到聊天页面...`);
            await new Promise((resolve) => setTimeout(resolve, 3000));
            currentUrl = page.url();
        }

        console.log(`   ⏳ 页面已跳转，等待完全加载（10秒）...`);
        await new Promise((resolve) => setTimeout(resolve, 10000));

        console.log(`\n✅ 已登录成功并保持浏览器开启。`);
        console.log(`   请直接在浏览器中使用，该会话不会自动关闭。`);
        console.log(`   如需结束，请手动关闭浏览器窗口或中断进程。`);
        success = true;
    } catch (error) {
        console.error(`   ❌ 登录过程出错: ${error.message}`);
        if (browser) {
            await browser.close();
        }
        throw error;
    }

    // 按要求保持浏览器开启；若成功则不关闭。
    if (!success && browser) {
        await browser.close();
    }

    // 阻塞等待用户操作结束
    if (success) {
        await promptInput("\n按回车键可结束与 CLI 的连接（浏览器自行关闭或继续使用均可）...", rl);
    }
}

/**
 * 更新单个子号的 token
 * @param {Object} childAccount - 子号信息
 * @param {string} token - 已登录的会话令牌
 */
async function refreshChildToken(childAccount, token) {
    try {
        // 登录并获取新 token
        const newTokens = await loginGeminiChild(childAccount, token);

        // 更新到配置文件
        updateChildToken(childAccount.email, newTokens);

        console.log(`   ✓ Token 已更新到配置文件`);
        return { success: true, email: childAccount.email, tokens: newTokens };
    } catch (error) {
        console.error(`   ❌ 刷新失败: ${error.message}`);
        return { success: false, email: childAccount.email, error: error.message };
    }
}

/**
 * 自动刷新所有 Gemini 子号的 token
 * @param {string} currentLoginEmail - 当前登录的母号邮箱
 * @param {string} token - 已登录的会话令牌
 */
async function autoRefreshGeminiTokens(currentLoginEmail, token) {
    console.log("\n" + "=".repeat(50));
    console.log("🚀 开始 Gemini Business 自动刷新");
    console.log("=".repeat(50));

    // 1. 检测母号是否匹配
    console.log("\n📋 步骤 1: 验证母号");
    const isParentMatch = verifyParentAccount(currentLoginEmail);

    if (!isParentMatch) {
        throw new Error("母号不匹配，无法继续执行。请确保使用正确的母号登录。");
    }

    console.log(`✓ 母号验证通过: ${currentLoginEmail}`);

    // 2. 获取所有子号
    console.log("\n📋 步骤 2: 获取子号列表");
    const children = getGeminiChildrenAccounts();

    if (children.length === 0) {
        console.log("⚠️  未找到任何子号，无需刷新");
        return { total: 0, success: 0, failed: 0, results: [] };
    }

    console.log(`✓ 找到 ${children.length} 个子号`);
    children.forEach((child, index) => {
        console.log(`   ${index + 1}. ${child.email} (ID: ${child.accountId})`);
    });

    // 3. 循环刷新每个子号的 token
    console.log("\n📋 步骤 3: 开始刷新 Token");
    console.log("-".repeat(50));

    const results = [];
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        console.log(`\n[${i + 1}/${children.length}] 处理子号: ${child.email}`);

        const result = await refreshChildToken(child, token);
        results.push(result);

        // 添加延迟，避免请求过快
        if (i < children.length - 1) {
            console.log("   ⏳ 等待 2 秒后继续...");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // 4. 统计结果
    console.log("\n" + "=".repeat(50));
    console.log("📊 刷新完成统计");
    console.log("=".repeat(50));

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    console.log(`总计: ${children.length} 个子号`);
    console.log(`✓ 成功: ${successCount} 个`);
    console.log(`✗ 失败: ${failedCount} 个`);

    if (failedCount > 0) {
        console.log("\n失败的子号:");
        results.filter(r => !r.success).forEach(r => {
            console.log(`  - ${r.email}: ${r.error}`);
        });
    }

    return {
        total: children.length,
        success: successCount,
        failed: failedCount,
        results,
    };
}

module.exports = {
    verifyParentAccount,
    loginGeminiChild,
    openGeminiChildInteractive,
    refreshChildToken,
    autoRefreshGeminiTokens,
};
