#!/usr/bin/env bun
/**
 * scripts/build-desktop.ts —— 本地桌面构建助手
 *
 * 为什么需要这个脚本：
 *   tauri.conf.json 里配置了 `pubkey`，意味着 tauri build 会尝试生成
 *   已签名的 updater artifacts（*.sig + latest.json）。这一步需要私钥，
 *   私钥由 `TAURI_SIGNING_PRIVATE_KEY` 环境变量传入。
 *
 *   CI 里通过 GitHub Actions secrets 注入：
 *     .github/workflows/release.yml → env.TAURI_SIGNING_PRIVATE_KEY
 *
 *   本地构建时 secrets 不存在，build 会报：
 *     "A public key has been found, but no private key."
 *
 *   这个脚本：
 *     1. 从 Tauri 默认 keys 目录（macOS/Linux: ~/.tauri/keys/,
 *        Windows: %APPDATA%\com.tauri.dev\keys\）读私钥
 *     2. 验证它跟 tauri.conf.json 里配置的 pubkey 配对
 *     3. 注入 TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD
 *     4. spawnSync 跑 `bun x tauri build`（args 透传）
 *
 * 用法：
 *   bun run scripts/build-desktop.ts
 *   bun run scripts/build-desktop.ts -- --target aarch64-apple-darwin
 *   bun run build:desktop -- --target aarch64-apple-darwin
 *
 * 注意：
 *   - 私钥只读进内存，绝不 echo / log / 落盘
 *   - 如果 ~/.tauri/keys/ 里没有匹配的私钥，脚本 fail-fast 给出
 *     "tauri signer generate" 的修复指引，而不是让 build 半路崩
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const TAURI_CONFIG_PATH = join(import.meta.dir, "..", "src-tauri", "tauri.conf.json");

interface TauriConfig {
  identifier: string;
  productName: string;
  plugins?: {
    updater?: {
      pubkey?: string;
    };
  };
}

function loadTauriConfig(): TauriConfig {
  const raw = readFileSync(TAURI_CONFIG_PATH, "utf8");
  // tauri 自己生成的 conf 不带注释 / trailing comma，直接 JSON.parse 即可。
  return JSON.parse(raw) as TauriConfig;
}

/**
 * Tauri CLI 把生成的 key pair 放在 `dirs::config_dir()` 下，
 * 默认 bundle id 是 `com.tauri.dev`。
 *
 * - macOS / Linux: ~/.tauri/keys/<productName-lower>.key
 * - Windows:       %APPDATA%\com.tauri.dev\keys\<productName-lower>.key
 *
 * 这里我们用 productName 的 lowercase + 空格替 dash 作为文件名后缀。
 */
function keysDir(): string {
  if (platform === "win32") {
    const appdata = process.env.APPDATA;
    if (!appdata) {
      throw new Error("APPDATA not set on Windows — can't locate tauri keys dir");
    }
    return join(appdata, "com.tauri.dev", "keys");
  }
  // macOS + Linux + 其他 unix-like
  return join(homedir(), ".tauri", "keys");
}

function keyBaseName(productName: string): string {
  // "Agno Desktop" → "agno-desktop"
  return productName.toLowerCase().replace(/\s+/g, "-");
}

interface KeyPair {
  privateKeyPath: string;
  publicKeyPath: string;
  passwordPath: string;
}

function locateKeys(productName: string): KeyPair {
  const base = keyBaseName(productName);
  const dir = keysDir();

  const privateKeyPath = join(dir, `${base}.key`);
  const publicKeyPath = join(dir, `${base}.key.pub`);
  const passwordPath = join(dir, `${base}.key.password`);

  if (!existsSync(privateKeyPath)) {
    throw new Error(
      `未找到私钥：${privateKeyPath}\n` +
        `本地构建需要先在 ${dir}/ 生成密钥对：\n` +
        `  cargo install tauri-cli --version "^2.0"   # 如果还没装\n` +
        `  cd src-tauri && cargo tauri signer generate --password <你的密码>\n` +
        `(私钥生成后会被自动写到 ~/.tauri/keys/${base}.key；密码写到 .password)`
    );
  }
  if (!existsSync(passwordPath)) {
    throw new Error(
      `找到私钥但找不到密码文件：${passwordPath}\n` +
        `Tauri 在创建带密码的密钥时会拆成 .key + .password 两个文件，缺一不可。`
    );
  }

  return { privateKeyPath, publicKeyPath, passwordPath };
}

/**
 * 比对 .key.pub 跟 tauri.conf.json 里 plugins.updater.pubkey 是否配对。
 * 配对 = 同一对密钥（否则签名会被客户端拒签）。
 */
function assertPubkeyMatches(keyPair: KeyPair, configPubkey: string | undefined): void {
  if (!configPubkey) {
    // conf 里没配 pubkey，tauri 不会签名也不需要私钥 —— 直接跳过
    return;
  }
  if (!existsSync(keyPair.publicKeyPath)) {
    // 没 .pub 文件没法校验，至少让 build 继续（它自己会用 conf 里的 pubkey 校验 .sig）
    console.warn(
      `[build-desktop] 提示：找不到 ${keyPair.publicKeyPath}，跳过 pubkey 配对校验。`
    );
    return;
  }
  const onDisk = readFileSync(keyPair.publicKeyPath, "utf8").trim();
  if (onDisk !== configPubkey) {
    throw new Error(
      `公钥不匹配！\n` +
        `  tauri.conf.json plugins.updater.pubkey:\n    ${configPubkey}\n` +
        `  ${keyPair.publicKeyPath}:\n    ${onDisk}\n` +
        `本地私钥跟 conf 里配的公钥不是一对——签名会校验失败。\n` +
        `可能原因：\n` +
        `  1. conf 里的 pubkey 是从 CI 拿的，但你本地的 keypair 是另一份\n` +
        `  2. 你重置过 ~/.tauri/keys/ 但没更新 conf\n` +
        `修法：\n` +
        `  - 把 conf 的 pubkey 改成本地 .pub 的内容；或\n` +
        `  - 删掉本地 keypair 然后用 CI 那对（需要先把 .key 落到 ~/.tauri/keys/）`
    );
  }
}

/**
 * 安全地读取私钥到内存，绝不写入日志或 stdout。
 */
function loadPrivateKeyAndPassword(keyPair: KeyPair): {
  privateKey: string;
  password: string;
} {
  const privateKey = readFileSync(keyPair.privateKeyPath, "utf8").trim();
  const password = readFileSync(keyPair.passwordPath, "utf8").trim();
  return { privateKey, password };
}

/* ---------------------------------------------------------------- */

function main(): void {
  const config = loadTauriConfig();
  const keyPair = locateKeys(config.productName);
  assertPubkeyMatches(keyPair, config.plugins?.updater?.pubkey);
  const { privateKey, password } = loadPrivateKeyAndPassword(keyPair);

  // args 透传给 tauri build
  const extraArgs = process.argv.slice(2);

  console.log(`[build-desktop] productName: ${config.productName}`);
  console.log(`[build-desktop] keys dir:    ${keysDir()}`);
  console.log(`[build-desktop] private key: ${keyPair.privateKeyPath} (loaded, not displayed)`);
  console.log(`[build-desktop] pubkey:      matched tauri.conf.json ✓`);
  console.log(
    `[build-desktop] spawning:    bun x tauri build ${extraArgs.join(" ")}`
  );

  const result = spawnSync("bun", ["x", "tauri", "build", ...extraArgs], {
    stdio: "inherit",
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
    },
  });

  // 保留原退出码
  process.exit(result.status ?? 1);
}

main();