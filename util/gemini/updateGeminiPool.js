const axios = require('axios');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Gemini Pool 平台配置
const GEMINI_POOL_URL = 'https://mgs.ccode.vip';
const GEMINI_MAIL_FILE = path.join(__dirname, '../../gemini-mail.yaml');

/**
 * 登录 Gemini Pool 平台获取 x-admin-token
 */
async function loginGeminiPool(password) {
    try {
        console.log('正在登录 Gemini Pool 平台...');
        const response = await axios.post(`${GEMINI_POOL_URL}/api/auth/login`, {
            password: password
        });

        if (response.data && response.data.token) {
            console.log('登录成功！');
            return response.data.token;
        } else {
            throw new Error('登录响应中没有 token');
        }
    } catch (error) {
        console.error('登录失败:', error.message);
        if (error.response) {
            console.error('响应状态:', error.response.status);
            console.error('响应数据:', error.response.data);
        }
        throw error;
    }
}

/**
 * 从 gemini-mail.yaml 读取账户信息
 */
function loadAccountsFromYaml() {
    try {
        const fileContent = fs.readFileSync(GEMINI_MAIL_FILE, 'utf8');
        const data = yaml.load(fileContent);
        return data;
    } catch (error) {
        console.error('读取 YAML 文件失败:', error.message);
        throw error;
    }
}

/**
 * 获取 Gemini Pool 平台上的所有账户
 */
async function getPoolAccounts(adminToken) {
    try {
        console.log('\n正在获取平台账户列表...');
        const response = await axios.get(`${GEMINI_POOL_URL}/api/accounts`, {
            headers: {
                'x-admin-token': adminToken
            }
        });

        if (response.data && response.data.accounts) {
            console.log(`找到 ${response.data.accounts.length} 个平台账户`);
            return response.data.accounts;
        } else {
            throw new Error('获取账户列表失败');
        }
    } catch (error) {
        console.error('获取账户列表失败:', error.message);
        if (error.response) {
            console.error('响应状态:', error.response.status);
            console.error('响应数据:', error.response.data);
        }
        throw error;
    }
}

/**
 * 测试单个账户是否可用
 */
async function testAccount(accountId, adminToken) {
    try {
        const response = await axios.get(`${GEMINI_POOL_URL}/api/accounts/${accountId}/test`, {
            headers: {
                'x-admin-token': adminToken
            }
        });

        return response.data && response.data.success === true;
    } catch (error) {
        console.error(`测试账户 ${accountId} 失败:`, error.message);
        return false;
    }
}

/**
 * 删除账户
 */
async function deleteAccount(accountId, adminToken) {
    try {
        const response = await axios.delete(`${GEMINI_POOL_URL}/api/accounts/${accountId}`, {
            headers: {
                'x-admin-token': adminToken
            }
        });

        return response.data && response.data.success === true;
    } catch (error) {
        console.error(`删除账户 ${accountId} 失败:`, error.message);
        return false;
    }
}

/**
 * 删除所有账户
 */
async function deleteAllAccounts(adminToken) {
    try {
        // 获取所有账户（按 id 降序删除，避免删除低 id 后高 id 重排导致 404）
        const accounts = (await getPoolAccounts(adminToken)).sort((a, b) => b.id - a.id);
        
        if (accounts.length === 0) {
            console.log('平台上没有账户需要删除');
            return 0;
        }
        
        console.log(`\n开始删除所有账户（共 ${accounts.length} 个）...`);
        
        let deletedCount = 0;
        
        for (const account of accounts) {
            const accountId = account.id;
            console.log(`正在删除账户 ID ${accountId}...`);
            
            const deleted = await deleteAccount(accountId, adminToken);
            if (deleted) {
                console.log(`✓ 账户 ${accountId} 已删除`);
                deletedCount++;
            } else {
                console.log(`✗ 账户 ${accountId} 删除失败`);
            }
            
            // 添加小延迟避免请求过快
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        console.log(`\n=== 删除完成 ===`);
        console.log(`已删除: ${deletedCount}/${accounts.length} 个账户`);
        
        return deletedCount;
        
    } catch (error) {
        console.error('删除账户失败:', error.message);
        throw error;
    }
}

/**
 * 添加新账户到平台
 */
async function addAccount(accountData, adminToken) {
    try {
        const response = await axios.post(`${GEMINI_POOL_URL}/api/accounts`, {
            team_id: accountData.team_id,
            secure_c_ses: accountData.secure_c_ses,
            host_c_oses: accountData.host_c_oses,
            csesidx: accountData.csesidx,
            user_agent: accountData.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
        }, {
            headers: {
                'x-admin-token': adminToken
            }
        });

        return response.data && response.data.success === true;
    } catch (error) {
        console.error('添加账户失败:', error.message);
        if (error.response) {
            console.error('响应数据:', error.response.data);
        }
        return false;
    }
}

/**
 * 添加所有账户
 */
async function addAllAccounts(yamlAccounts, adminToken) {
    try {
        console.log('\n=== 开始添加账户 ===');
        
        let addedCount = 0;
        let skippedCount = 0;
        
        // 遍历 YAML 中的子账户
        if (yamlAccounts.children && yamlAccounts.children.length > 0) {
            for (const child of yamlAccounts.children) {
                if (!child.tokens) {
                    console.log(`\n跳过账户 ${child.email}: 没有 tokens 信息`);
                    skippedCount++;
                    continue;
                }
                
                const accountData = {
                    team_id: child.tokens.team_id,
                    secure_c_ses: child.tokens.secure_c_ses,
                    host_c_oses: child.tokens.host_c_oses,
                    csesidx: child.tokens.csesidx,
                    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
                };
                
                console.log(`\n正在添加账户 ${child.email}...`);
                const success = await addAccount(accountData, adminToken);
                
                if (success) {
                    console.log(`✓ 账户 ${child.email} 添加成功`);
                    addedCount++;
                } else {
                    console.log(`✗ 账户 ${child.email} 添加失败`);
                }
                
                // 添加小延迟
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        
        // 获取最终账户总数
        const finalAccounts = await getPoolAccounts(adminToken);
        
        console.log('\n=== 添加完成 ===');
        console.log(`成功添加: ${addedCount}`);
        console.log(`跳过: ${skippedCount}`);
        console.log(`当前总数: ${finalAccounts.length}`);
        
        return { addedCount, skippedCount, totalCount: finalAccounts.length };
        
    } catch (error) {
        console.error('添加账户失败:', error.message);
        throw error;
    }
}

/**
 * 更新 Gemini Pool 的主函数（删除所有账户并重新添加）
 */
async function updateGeminiPool() {
    try {
        // 1. 读取 gemini-mail.yaml
        console.log('读取账户信息...');
        const yamlData = loadAccountsFromYaml();
        const password = yamlData.password;
        const accounts = yamlData.accounts;

        if (!accounts.children || accounts.children.length === 0) {
            console.log('❌ gemini-mail.yaml 中没有子账户，请先选择账户');
            return;
        }

        // 2. 登录获取 token
        const adminToken = await loginGeminiPool(password);

        // 3. 删除所有账户
        await deleteAllAccounts(adminToken);

        // 4. 添加所有账户
        await addAllAccounts(accounts, adminToken);

        console.log('\n✓ 所有任务完成！');

    } catch (error) {
        console.error('执行失败:', error.message);
        throw error;
    }
}

// 导出函数供其他模块使用
module.exports = updateGeminiPool;

// 如果直接运行此文件，则执行主函数
if (require.main === module) {
    updateGeminiPool().catch(error => {
        console.error('执行失败:', error.message);
        process.exit(1);
    });
}
