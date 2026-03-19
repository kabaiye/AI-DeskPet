
# AI-DeskPet（AI 桌宠）

> 一款 AI 驱动的可定制桌面宠物应用，基于 Electron 构建。

不只是桌面挂件——AI 桌宠拥有独立人格、情绪记忆和主动交互能力。支持自定义角色，让你的桌面伙伴真正与众不同。

如果你觉得 AI 不应该只有智商还应该有情商，请为我们点个 ⭐！

## 功能特色

### 🤖 AI 智能交互
- **AI 驱动的情绪陪伴** — 基于智谱 GLM 大模型，提供有温度的智能对话
- **截图分析** — 截图后 AI 智能分析内容并回答问题
- **智能任务管理** — 对话即可创建待办事项，提醒与管理
- **主动问候与闲聊** — 根据时间主动关心你，不打扰但有存在感
- **戳一戳互动记忆** — 连续互动时 AI 会记住上下文

### 🎭 角色系统
- **多角色支持** — 内置多个角色，支持一键切换
- **角色创建** — 在设置页点击"创建新角色"，填写名称和性格，AI 自动生成预设
- **角色编辑** — 设置页点击"编辑"可修改当前角色的所有配置
- **自定义表情** — 上传 GIF 表情并自定义命名，AI 根据情绪自动选择
- **性格预设** — 每个角色支持多组性格预设，可在设置中快速切换
- **完全可定制** — 所有配置均可通过 `characters/{角色ID}.json` 文件直接编辑

### 💧 生活助手
- **智能健康提醒** — AI 生成的喝水提醒，可爱又实用
- **快捷聊天** — 快捷键弹出输入框，随时与桌宠对话

### ⚙️ 个性化设置
- **统一设置面板** — 角色切换、性格调整、透明度、快捷键全部集中管理
- **自定义快捷键** — 所有快捷键可自由录制和修改
- **透明度调节** — 调整桌宠窗口透明度，不遮挡工作

## 默认快捷键

| 快捷键     | 功能         |
| ---------- | ------------ |
| `Alt+F1`  | 快捷聊天     |
| `Alt+F2`  | AI 区域截图  |
| `Alt+F3`  | 戳一戳桌宠   |
| `Ctrl+H`   | 隐藏/显示桌宠 |
| `Ctrl+T`   | 打开待办窗口 |
| `Ctrl+O`   | 打开主窗口   |

所有快捷键均可在桌宠设置中自定义，支持 Ctrl/Shift/Alt 组合键。录制时按 Delete/Backspace 可清除已设置的快捷键。

## 项目结构

```
├── package.json               # 项目配置
├── .env.example               # 环境变量模板
├── scripts/                   # 启动/打包脚本
├── characters/                # 角色配置文件（可热修改）
│   ├── default.json           # 当前激活角色
│   ├── xiaohei.json           # 罗小黑
│   ├── jokebear.json          # 自嘲熊
│   └── ...                    # 自定义角色
├── src/
│   ├── main/                  # 主进程（Node.js）
│   │   ├── index.js           # Electron 主入口
│   │   ├── config.js          # 配置管理
│   │   ├── aiService.js       # AI 服务（含戳一戳会话记忆）
│   │   ├── characterService.js # 角色管理与提示词构建
│   │   ├── storageService.js  # 文件持久化
│   │   ├── activityMonitor.js # 活动监控
│   │   └── proactiveEngine.js # 主动交互引擎
│   ├── renderer/              # 渲染进程（HTML 页面）
│   │   ├── index.html         # 主窗口
│   │   ├── pet.html           # 桌宠窗口
│   │   ├── chatWindow.html    # 聊天窗口
│   │   ├── petSettings.html   # 统一设置面板
│   │   ├── characterCreator.html # 角色创建/编辑器
│   │   └── ...                # 其他页面
│   └── assets/imgs/           # 角色素材（GIF/PNG）
└── XiaoHeiCat_Data/           # 运行时数据（自动生成，已 gitignore）
    ├── settings.json          # 全局设置（API Key）
    └── chatHistory.json       # 聊天记录（切换角色时清空）
```

## 运行指南

```bash
# 安装依赖
npm install

# 启动应用
npm start
```

### 环境配置

参考 `.env.example`，或在应用内「桌宠设置 → API Key 设置」中配置智谱 AI API Key。

申请地址：[智谱 AI 开放平台](https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys)（免费模型，注册即可使用）

### 打包为 EXE

```bash
npm run build:win
```

打包后的安装包将生成在 `dist` 目录中。`characters/` 和 `assets/` 文件夹会被外置，用户安装后可直接添加新角色和素材。

## 创建自定义角色

1. **方式一（推荐）**：在桌宠设置中选择"创建新角色"，填写名称和性格描述，AI 自动生成完整配置
2. **方式二**：复制 `characters/xiaohei.json` 为新文件，修改各配置项（JSON 中 `_说明` 字段有详细注释）
3. 在 `src/assets/imgs/` 下创建角色素材文件夹，放入 GIF/PNG 文件
4. 在桌宠设置中切换到新角色，重启应用生效

## 未来计划

* 声音克隆实现更拟人化的语音交互
* 前端采用 three.js 打造更细致的视觉表现
* 桌面行为模式学习与个性化推荐
