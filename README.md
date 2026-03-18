
# XiaoHeiCat：让小黑做你的上班搭子

> 一款 AI 驱动的桌面宠物应用，基于 Electron 构建。

如果你也相信 AI 不应该只有智商还应该有情商，或者单纯喜欢罗小黑一样可可爱爱的国漫 IP，请为我们点个 ⭐！

## 功能特色

- **AI 驱动的情绪陪伴** — 基于智谱 GLM 大模型的智能交互，提供有温度的桌面陪伴
- **个性化桌宠体验** — 自定义桌宠名字和性格，AI 根据设定生成个性化回应
- **智能健康管理** — AI 生成的健康提醒，时间感知的问候语
- **智能任务管理** — AI 自动识别截图中的待办事项，智能提醒和管理
- **主动问候与闲聊** — 小黑会根据时间、天气等主动关心你
- **快捷聊天** — F1 弹出输入框，快速与小黑对话
- **截图提问** — 截图后附加问题，AI 智能分析并回答

## 快捷键

| 快捷键     | 功能         |
| ---------- | ------------ |
| `Alt+F1`  | 快捷聊天     |
| `Alt+F2`  | AI 区域截图  |
| `Alt+F3`  | 戳一戳小黑   |
| `Ctrl+H`   | 隐藏/显示桌宠 |
| `Ctrl+T`   | 打开待办窗口 |
| `Ctrl+O`   | 打开主窗口   |

所有快捷键均可在「快捷键设置」中自定义，支持 Ctrl/Shift/Alt 组合键。喝水提醒、打开聊天窗口等功能默认无快捷键，可在设置中手动绑定；录制时按 Delete/Backspace 可清除已设置的快捷键。

## 项目结构

```
├── package.json            # 项目配置（入口、依赖、构建）
├── .env.example            # 环境变量模板
├── scripts/                # 启动/打包脚本
│   ├── start.js
│   └── build.js
├── src/
│   ├── main/               # 主进程（Node.js）
│   │   ├── index.js        # Electron 主入口
│   │   ├── config.js       # 配置管理
│   │   ├── aiService.js    # AI 服务
│   │   ├── storageService.js  # 文件持久化
│   │   ├── activityMonitor.js # 活动监控
│   │   └── proactiveEngine.js # 主动交互引擎
│   ├── renderer/           # 渲染进程（HTML 页面）
│   │   ├── index.html      # 主窗口
│   │   ├── pet.html        # 桌宠
│   │   ├── chatWindow.html # 聊天窗口
│   │   ├── bubble.html     # 气泡
│   │   └── ...             # 其他页面
│   └── assets/             # 静态资源
│       └── imgs/           # 图片/GIF
└── XiaoHeiCat_Data/        # 运行时数据（自动生成，已 gitignore）
```

## 运行指南

```bash
# 安装依赖
npm install

# 启动应用
npm start
```

### 环境配置

参考 `.env.example`，或在应用内"桌宠设置 → API Key 设置"中配置智谱 AI API Key。

申请地址：[智谱 AI 开放平台](https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys)

### 打包为 EXE

```bash
npm run build:win
```

打包后的安装包将生成在 `dist` 目录中。

## 未来计划

* 声音克隆实现更拟人化的语音交互
* 前端采用 three.js 打造更细致的视觉表现
* 桌面行为模式学习与个性化推荐
