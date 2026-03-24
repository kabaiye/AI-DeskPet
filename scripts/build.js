const { exec } = require('child_process');
const path = require('path');

console.log('🚀 开始打包应用...');

// 检查是否安装了electron-builder
const checkElectronBuilder = () => {
    return new Promise((resolve, reject) => {
        exec('npx electron-builder --version', (error, stdout, stderr) => {
            if (error) {
                console.log('❌ electron-builder 未安装，正在安装...');
                installElectronBuilder().then(resolve).catch(reject);
            } else {
                console.log(`✅ electron-builder 已安装，版本: ${stdout.trim()}`);
                resolve();
            }
        });
    });
};

// 安装electron-builder
const installElectronBuilder = () => {
    return new Promise((resolve, reject) => {
        console.log('📦 正在安装 electron-builder...');
        exec('npm install --save-dev electron-builder', (error, stdout, stderr) => {
            if (error) {
                console.error('❌ 安装 electron-builder 失败:', error);
                reject(error);
            } else {
                console.log('✅ electron-builder 安装成功');
                resolve();
            }
        });
    });
};

// 执行打包
const buildApp = () => {
    return new Promise((resolve, reject) => {
        console.log('🔨 正在打包应用...');
        exec('npx electron-builder --win', (error, stdout, stderr) => {
            if (error) {
                console.error('❌ 打包失败:', error);
                reject(error);
            } else {
                console.log('✅ 打包成功!');
                console.log(stdout);
                resolve();
            }
        });
    });
};

// 主流程
const main = async () => {
    try {
        await checkElectronBuilder();
        await buildApp();
        console.log('🎉 应用打包完成！');
        console.log('📁 输出目录: dist/');
    } catch (error) {
        console.error('💥 打包过程中出现错误:', error);
        process.exit(1);
    }
};

main();
