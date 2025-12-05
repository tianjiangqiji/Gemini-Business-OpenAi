const geminiAutoRefresh = require("./gemini/geminiAutoRefresh");
const updateGeminiPool = require("./gemini/updateGeminiPool");
const { autoLogin } = require("./auth");

async function main() {
  console.log("=".repeat(50));
  console.log("快速刷新所有账户 Token 并同步到 Gemini Pool");
  console.log("(同菜单中‘（HOT）刷新所有账户 Token 并同步到 Gemini Pool’)");
  console.log("=".repeat(50));

  const sessionToken = await autoLogin();

  await geminiAutoRefresh(sessionToken);

  console.log("\n" + "=".repeat(50));
  console.log("正在同步到 Gemini Pool...");
  console.log("=".repeat(50));
  await updateGeminiPool();

  console.log("\n✓ 快速刷新流程完成");
}

main().catch((error) => {
  console.error("\n❌ 快速刷新失败:", error.message);
  process.exit(1);
});
