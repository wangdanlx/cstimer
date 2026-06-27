// 设置模块搜索路径为 bubblewrap 的 node_modules
const bubblewrapPath = '/usr/local/lib/node_modules/@bubblewrap/cli/node_modules';
module.paths.unshift(bubblewrapPath);

const path = require('path');
const fs = require('fs');
const Color = require('color');
const { TwaManifest } = require('/usr/local/lib/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/TwaManifest');
const { TwaGenerator } = require('/usr/local/lib/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/TwaGenerator');
const { Config } = require('/usr/local/lib/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/Config');
const { ConsoleLog } = require('/usr/local/lib/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/Log');
const { JdkHelper } = require('/usr/local/lib/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/jdk/JdkHelper');
const { KeyTool } = require('/usr/local/lib/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/jdk/KeyTool');
const { AndroidSdkTools } = require('/usr/local/lib/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/androidSdk/AndroidSdkTools');
const { GradleWrapper } = require('/usr/local/lib/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core/dist/lib/GradleWrapper');

async function main() {
    const log = new ConsoleLog('build');
    const outputDir = '/workspace/cstimer/android';

    if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    // 加载配置
    const config = await Config.loadConfig('/root/.bubblewrap/config.json');
    const jdkHelper = new JdkHelper(process, config);

    // 从 Web Manifest 创建 TwaManifest
    const manifestUrl = 'http://localhost:8080/cstimer.webmanifest';
    const twaManifest = await TwaManifest.fromWebManifest(manifestUrl);

    // 设置必要字段
    twaManifest.packageId = 'com.cstimer.app';
    twaManifest.name = 'csTimer';
    twaManifest.launcherName = 'csTimer';
    twaManifest.host = 'localhost:8080';
    twaManifest.startUrl = '/index.html';
    twaManifest.themeColor = new Color('#FFCC00');
    twaManifest.backgroundColor = new Color('#FFFFFF');
    twaManifest.appVersionCode = 1;
    twaManifest.appVersionName = '1.0.0';
    twaManifest.fallbackType = 'customtabs';
    twaManifest.display = 'standalone';
    twaManifest.enableNotifications = false;
    twaManifest.splashScreenFadeOutDuration = 300;
    twaManifest.generatorApp = 'monkeycode-ai';

    // 生成签名密钥
    const keystorePath = path.join(outputDir, 'android.keystore');
    const keyAlias = 'cstimer';
    const keyPassword = 'cstimer2024';
    const keyTool = new KeyTool(jdkHelper, log);

    const keyOptions = {
        path: keystorePath,
        alias: keyAlias,
        password: keyPassword,
        keypassword: keyPassword,
        fullName: 'csTimer Developer',
        organizationalUnit: 'Dev',
        organization: 'csTimer',
        country: 'US',
    };

    await keyTool.createSigningKey(keyOptions, true);

    twaManifest.signingKey = {
        path: keystorePath,
        alias: keyAlias,
    };

    // 保存 twa-manifest.json
    const manifestPath = path.join(outputDir, 'twa-manifest.json');
    await twaManifest.saveToFile(manifestPath);
    console.log('twa-manifest.json created');

    // 生成 Android 项目
    const twaGenerator = new TwaGenerator();
    await twaGenerator.createTwaProject(outputDir, twaManifest, log);

    // 设置 local.properties
    const localProperties = `sdk.dir=${config.androidSdkPath}\n`;
    fs.writeFileSync(path.join(outputDir, 'local.properties'), localProperties);

    // 设置 gradle.properties 中签名信息
    const gradlePropsPath = path.join(outputDir, 'gradle.properties');
    let gradleProps = fs.readFileSync(gradlePropsPath, 'utf8');
    gradleProps += `\nandroid.injected.signing.store.file=${keystorePath}\n`;
    gradleProps += `android.injected.signing.store.password=${keyPassword}\n`;
    gradleProps += `android.injected.signing.key.alias=${keyAlias}\n`;
    gradleProps += `android.injected.signing.key.password=${keyPassword}\n`;
    fs.writeFileSync(gradlePropsPath, gradleProps);

    console.log('Android project generated at:', outputDir);

    // 构建 APK
    console.log('Building APK...');
    const androidSdkTools = new AndroidSdkTools(process, config, jdkHelper, log);
    const gradleWrapper = new GradleWrapper(process, androidSdkTools, outputDir);
    await gradleWrapper.assembleRelease();
    console.log('Build succeeded!');

    // 查找生成的 APK
    const apkDir = path.join(outputDir, 'app/build/outputs/apk/release');
    const files = fs.readdirSync(apkDir);
    for (const f of files) {
        if (f.endsWith('.apk')) {
            const apkPath = path.join(apkDir, f);
            const destPath = '/workspace/cstimer/android/app-release.apk';
            fs.copyFileSync(apkPath, destPath);
            console.log('APK copied to:', destPath);
            const stats = fs.statSync(destPath);
            console.log('APK size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
        }
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
