const registerTempEmail = require("./util/mail/tempMail");
const createAccount = require("./util/mail/createAccount");
const deleteAccount = require("./util/mail/deleteAccount");
const getVerificationCode = require("./util/mail/getVerificationCode");
const geminiAutoRefresh = require("./util/gemini/geminiAutoRefresh");
const updateGeminiPool = require("./util/gemini/updateGeminiPool");
const selectBusinessAccounts = require("./util/gemini/selectBusinessAccounts");
const cleanInvalidAccounts = require("./util/gemini/cleanInvalidAccounts");
const { openGeminiChildInteractive } = require("./util/gemini/autoRefresh");
const { getGeminiChildrenAccounts } = require("./util/gemini/geminiConfig");
const { autoLogin } = require("./util/auth");
const readline = require("readline");

// 全局会话 token，在程序启动时获取
let sessionToken = null;

// 邮箱管理工具
const mailTools = [
  {
    id: "1",
    name: "重新获取所有邮箱",
    action: async () => {
      if (!sessionToken) {
        throw new Error("会话令牌未初始化，请重启程序");
      }
      return await registerTempEmail(sessionToken);
    },
  },
  {
    id: "2",
    name: "新建子号",
    action: async () => {
      if (!sessionToken) {
        throw new Error("会话令牌未初始化，请重启程序");
      }
      return await createAccount(sessionToken);
    },
  },
  {
    id: "3",
    name: "删除子号",
    action: async (rl) => {
      if (!sessionToken) {
        throw new Error("会话令牌未初始化，请重启程序");
      }
      return await deleteAccount(sessionToken, rl);
    },
  },
];

// ChatGPT 管理工具
const chatgptTools = [
  {
    id: "1",
    name: "获取最新登录验证码",
    action: async (rl) => {
      if (!sessionToken) {
        throw new Error("会话令牌未初始化，请重启程序");
      }
      return await getVerificationCode(sessionToken, rl);
    },
  },
];

// Gemini Business 管理工具
const geminiTools = [
  {
    id: "1",
    name: "重置 gemini-mail.yaml 文件(重选已注册的企业版账号)",
    action: async (rl) => {
      return await selectBusinessAccounts(rl);
    },
  },
  {
    id: "2",
    name: "检查并去除失效账户(Gemini Pool)",
    action: async () => {
      return await cleanInvalidAccounts();
    },
  },
  {
    id: "3",
    name: "（HOT）刷新所有账户 Token 并同步到 Gemini Pool",
    action: async () => {
      if (!sessionToken) {
        throw new Error("会话令牌未初始化，请重启程序");
      }
      await geminiAutoRefresh(sessionToken);
      
      // 自动继续同步到 Gemini Pool（删除所有并重新添加）
      console.log("\n" + "=".repeat(50));
      console.log("正在同步 Token 到 Gemini Pool 平台...");
      console.log("=".repeat(50));
      await updateGeminiPool();
    },
  },
  {
    id: "4",
    name: "仅同步 gemini-mail.yaml 到 Gemini Pool(不重新获取 Token)",
    action: async () => {
      console.log("\n" + "=".repeat(50));
      console.log("仅同步 gemini-mail.yaml 到 Gemini Pool 平台...");
      console.log("=".repeat(50));
      await updateGeminiPool();
    },
  },
  {
    id: "5",
    name: "临时在线使用网页版（选择一个账户）",
    action: async (rl) => {
      if (!sessionToken) {
        throw new Error("会话令牌未初始化，请重启程序");
      }

      const children = getGeminiChildrenAccounts();
      if (!children || children.length === 0) {
        console.log("❌ gemini-mail.yaml 中没有子账户，请先配置后再试。");
        return;
      }

      console.log("\n当前 Gemini 子账户列表：");
      console.log("=".repeat(80));
      children.forEach((child, idx) => {
        console.log(`${String(idx + 1).padEnd(3)} | ${child.email} | accountId: ${child.accountId ?? "未知"}`);
      });
      console.log("=".repeat(80));

      const choice = await prompt("\n请选择要使用的序号（0 取消）: ", rl);
      if (choice === "0") {
        console.log("已取消。");
        return;
      }

      const selectedIdx = parseInt(choice, 10) - 1;
      if (Number.isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= children.length) {
        throw new Error("无效的序号");
      }

      const selectedChild = children[selectedIdx];
      await openGeminiChildInteractive(sessionToken, selectedChild, rl);
    },
  },
];

// 主菜单分类
const categories = [
  { id: "1", name: "邮箱管理", tools: mailTools },
  { id: "2", name: "ChatGPT 管理", tools: chatgptTools },
  { id: "3", name: "Gemini Business 管理", tools: geminiTools },
];

async function prompt(question, rl) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function renderMainMenu() {
  console.log("\n请选择管理类别（输入编号，q 退出）：");
  categories.forEach((category) => {
    console.log(`  ${category.id}. ${category.name}`);
  });
}

function renderSubMenu(category) {
  console.log(`\n【${category.name}】可用工具（输入编号，b 返回上级菜单）：`);
  category.tools.forEach((tool) => {
    console.log(`  ${tool.id}. ${tool.name}`);
  });
}

async function main() {
  console.log("=".repeat(50));
  console.log("欢迎使用临时邮箱管理工具");
  console.log("=".repeat(50));
  console.log();

  // 启动时自动登录母号
  try {
    sessionToken = await autoLogin();
  } catch (error) {
    console.error("❌ 母号登录失败:", error.message);
    console.error("请检查 temp-mail.yaml 中的账号密码配置");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 主循环：显示主菜单
  let running = true;
  while (running) {
    renderMainMenu();
    const categorySelection = await prompt("\n请选择类别编号: ", rl);

    if (categorySelection.toLowerCase() === "q") {
      console.log("已退出。");
      running = false;
      break;
    }

    const category = categories.find((cat) => cat.id === categorySelection);
    if (!category) {
      console.log("❌ 无效选择，请重新输入。\n");
      continue;
    }

    // 子菜单循环
    let inSubMenu = true;
    while (inSubMenu) {
      renderSubMenu(category);
      const toolSelection = await prompt("\n请选择工具编号: ", rl);

      if (toolSelection.toLowerCase() === "b") {
        inSubMenu = false;
        break;
      }

      const tool = category.tools.find((t) => t.id === toolSelection);
      if (!tool) {
        console.log("❌ 无效选择，请重新输入。\n");
        continue;
      }

      try {
        console.log(`\n执行工具: ${tool.name}`);
        console.log("-".repeat(50));
        await tool.action(rl);
        console.log("-".repeat(50));
        console.log("✓ 执行完成\n");

        // 如果是邮箱管理的新建子号或删除子号,自动运行重新获取所有邮箱
        if (category.id === "1" && (tool.id === "2" || tool.id === "3")) {
          console.log("正在自动同步邮箱列表...");
          console.log("-".repeat(50));
          await mailTools[0].action(rl); // 重新获取所有邮箱
          console.log("-".repeat(50));
          console.log("✓ 邮箱列表已同步\n");
        }
      } catch (error) {
        console.error(`❌ ${tool.name} 执行失败:`, error.message);
        console.log(); // 添加空行
      }
    }
  }

  rl.close();
}

main();

