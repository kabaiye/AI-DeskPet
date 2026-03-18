// 加载环境变量
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { app, BrowserWindow, globalShortcut, Notification, ipcMain, Menu } = require('electron');
const Screenshots = require('electron-screenshots');
const { ActivityMonitor, setCreatePetStatusWindowFunction, setCreateWaterReminderWindowFunction } = require('./activityMonitor');
const { analyzeScreenshot, generateFunReminder, generatePokeReaction, updatePetSettings, chatWithPet, clearChatHistory, getCurrentPetSettings } = require('./aiService');
const proactiveEngine = require('./proactiveEngine');
const storage = require('./storageService');
const config = require('./config');

// 渲染页面路径辅助
function rendererPath(name) {
  return path.join(__dirname, '../renderer', name);
}

// 禁用GPU加速以解决Passthrough错误
app.disableHardwareAcceleration();

// 设置应用用户模型ID，解决Windows通知问题
app.setAppUserModelId("com.desktripper.app");

// 禁用默认菜单栏
Menu.setApplicationMenu(null);

// 设置Electron缓存目录，解决权限问题
app.setPath('userData', path.join(app.getPath('appData'), 'DeskTripper'));

let mainWindow;
let bubbleWindow;
let waterReminderWindow;
let petWindow;
let todoWindow = null; // 待办窗口
let shortcutSettingsWindow = null; // 快捷键设置窗口
let petSettingsWindow = null; // 桌宠设置窗口
let contextMenuWindow = null;
let transparencyWindow = null; // 添加右键菜单窗口跟踪
let chatWindow = null; // 聊天窗口
let chatDisplayMessages = []; // 运行时聊天记录，启动时从文件加载
let screenshots = null; // 第三方区域截屏实例
let screenshotQuestionWindow = null; // 截图追问输入框
let pendingScreenshotBase64 = null; // 等待提问的截图缓存

// 拖动相关变量
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let dragInterval = null;

/**
 * 获取桌宠当前所在的屏幕（兼容多屏）
 * 如果桌宠窗口不存在则返回主屏
 */
function getPetDisplay() {
  const { screen } = require('electron');
  if (petWindow && !petWindow.isDestroyed()) {
    const [px, py] = petWindow.getPosition();
    const [pw, ph] = petWindow.getSize();
    return screen.getDisplayNearestPoint({ x: px + pw / 2, y: py + ph / 2 });
  }
  return screen.getPrimaryDisplay();
}


// 吸附状态管理 - 暂时注释掉
// let isSnapped = false;
// let snapInfo = {
//   type: '',
//   position: null,
//   attachedWindow: null
// };

// 桌宠状态管理
let petStateTimer = null;
let currentPetEmotion = null;
const PET_STATE_DURATION = 5000; // 状态持续时间（毫秒）

// 添加透明度状态变量
let currentPetTransparency = 100;

// 待办提醒相关变量
let todoReminderTimer = null;
let lastTodoReminderTime = 0;
const TODO_REMINDER_INTERVAL = 30 * 60 * 1000; // 30分钟提醒一次

// 小黑窗口管理
let petStatusWindow = null;
let activityMonitor;

// 创建主窗口
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true // 隐藏菜单栏
  });

  // 加载主界面
  mainWindow.loadFile(rendererPath('index.html'));

  // 监听窗口关闭事件，隐藏而不是销毁
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // 监听窗口中的用户活动
  mainWindow.webContents.on('dom-ready', () => {
    // 注入活动监听脚本
    mainWindow.webContents.executeJavaScript(`
      document.addEventListener('mousemove', () => {
        require('electron').ipcRenderer.send('user-activity');
      });
      
      document.addEventListener('keydown', () => {
        require('electron').ipcRenderer.send('user-activity');
      });
    `);
  });
}

// 创建宠物窗口
function createPetWindow() {
  petWindow = new BrowserWindow({
    width: 100,
    height: 100,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true, // 不在任务栏显示
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    movable: true, // 允许窗口移动
    focusable: true, // 允许窗口获得焦点
    type: 'toolbar' // 设置为工具栏类型，确保始终在最顶层
  });

  petWindow.loadFile(rendererPath('pet.html'));

  // 设置宠物窗口初始位置到右下角
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  petWindow.setPosition(
    width - 120,
    height - 120
  );

  // 允许鼠标事件，但不穿透
  petWindow.setIgnoreMouseEvents(false);

  // 设置窗口可以拖拽
  petWindow.setMovable(true);

  // 确保窗口始终在最顶层
  petWindow.setAlwaysOnTop(true, 'screen-saver');

  // 监听窗口失去焦点事件，确保重新置顶
  petWindow.on('blur', () => {
    if (!petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  // 监听窗口隐藏事件，确保重新显示时置顶
  petWindow.on('show', () => {
    if (!petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  // 定期检查并确保窗口始终在最顶层
  const ensureTopMost = setInterval(() => {
    if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
      petWindow.setAlwaysOnTop(true, 'screen-saver');
    } else {
      clearInterval(ensureTopMost);
    }
  }, 5000); // 每5秒检查一次

  // 监听宠物点击事件
  petWindow.webContents.on('dom-ready', () => {
    petWindow.webContents.executeJavaScript(`
      try {
        const pet = document.getElementById('pet');
        if (pet) {
          pet.addEventListener('click', () => {
            console.log('Pet clicked, triggering fun reminder');
            require('electron').ipcRenderer.send('pet-clicked');
          });
          console.log('Pet click event listener added successfully');
        } else {
          console.error('Pet element not found');
        }
      } catch (error) {
        console.error('Error setting up pet click listener:', error);
      }
    `).catch(error => {
      console.error('Error executing JavaScript in pet window:', error);
    });
  });

  // 戳一戳：防抖 + 连戳计数
  let pokeCount = 0;
  let pokeDebounceTimer = null;
  let pokeResetTimer = null;
  let pokeProcessing = false;
  const POKE_DEBOUNCE_MS = 800;
  const POKE_COUNT_RESET_MS = 30000; // 30秒无操作重置计数

  function triggerPoke() {
    pokeCount++;
    console.log(`Pet poked! count: ${pokeCount}`);

    if (pokeResetTimer) clearTimeout(pokeResetTimer);
    pokeResetTimer = setTimeout(() => { pokeCount = 0; }, POKE_COUNT_RESET_MS);

    if (pokeDebounceTimer) clearTimeout(pokeDebounceTimer);
    if (pokeProcessing) return;

    pokeDebounceTimer = setTimeout(async () => {
      if (pokeProcessing) return;
      pokeProcessing = true;
      try {
        const currentCount = pokeCount;
        console.log(`[Poke] Generating AI reaction for ${currentCount} pokes`);
        const { message, emotion } = await generatePokeReaction(currentCount);
        console.log(`[Poke] ${emotion}: ${message}`);

        createPetStatusWindow(message);

        if (emotion && petWindow && !petWindow.isDestroyed()) {
          petWindow.webContents.send('change-emotion', emotion);
          setTimeout(() => {
            if (petWindow && !petWindow.isDestroyed()) {
              petWindow.webContents.send('reset-emotion');
            }
          }, 4000);
        }
      } catch (error) {
        console.error('Poke reaction error:', error);
        createPetStatusWindow('喵？');
      } finally {
        pokeProcessing = false;
      }
    }, POKE_DEBOUNCE_MS);
  }

  ipcMain.on('pet-clicked', () => triggerPoke());

  // 监听打开主窗口事件
  ipcMain.on('open-main-window', (event) => {
    console.log('Opening main window from pet context menu');
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createMainWindow();
      }
    } catch (error) {
      console.error('Error opening main window:', error);
    }
  });

  // 监听退出应用事件
  ipcMain.on('exit-app', (event) => {
    console.log('Exiting app from context menu');
    try {
      app.isQuitting = true;
      app.quit();
    } catch (error) {
      console.error('Error exiting app:', error);
    }
  });

  // 监听显示右键菜单事件
  ipcMain.on('show-context-menu', (event, x, y) => {
    console.log('Showing context menu at:', x, y);
    try {
      // 获取桌宠窗口位置来优化菜单显示方向
      const petPosition = petWindow ? petWindow.getPosition() : [0, 0];
      createContextMenuWindow(x, y, petPosition);

      // 设置全局点击监听器来关闭右键菜单
      setTimeout(() => {
        setupGlobalClickHandler();
      }, 100);
    } catch (error) {
      console.error('Error creating context menu window:', error);
    }
  });

  // 监听获取宠物窗口位置事件
  ipcMain.on('get-pet-window-position', (event) => {
    if (petWindow && !petWindow.isDestroyed()) {
      try {
        const [x, y] = petWindow.getPosition();
        event.reply('pet-window-position', x, y);
        console.log('获取宠物窗口位置:', x, y);
      } catch (error) {
        console.error('获取宠物窗口位置失败:', error);
      }
    }
  });

  // 监听拖动开始事件 — 主进程全局轮询鼠标位置
  ipcMain.on('drag-start', (event, { offsetX, offsetY }) => {
    console.log('Drag started with offset:', offsetX, offsetY);
    isDragging = true;
    dragOffset = { x: offsetX, y: offsetY };

    if (dragInterval) {
      clearInterval(dragInterval);
      dragInterval = null;
    }

    const { screen } = require('electron');
    dragInterval = setInterval(() => {
      if (!isDragging || !petWindow || petWindow.isDestroyed()) {
        clearInterval(dragInterval);
        dragInterval = null;
        return;
      }
      const cursor = screen.getCursorScreenPoint();
      const newX = Math.round(cursor.x - dragOffset.x);
      const newY = Math.round(cursor.y - dragOffset.y);
      petWindow.setPosition(newX, newY);
    }, 16);
  });

  // 保留旧接口兼容（不再主动使用）
  ipcMain.on('move-pet-absolute', (event, { mouseX, mouseY }) => {
    if (petWindow && isDragging) {
      const newX = Math.round(mouseX - dragOffset.x);
      const newY = Math.round(mouseY - dragOffset.y);
      petWindow.setPosition(newX, newY);
    }
  });

  // 监听设置宠物窗口位置事件（保留用于其他功能）
  ipcMain.on('set-pet-window-position', (event, x, y) => {
    if (petWindow && !petWindow.isDestroyed()) {
      try {
        petWindow.setPosition(x, y);
        console.log('设置宠物窗口位置:', x, y);
      } catch (error) {
        console.error('设置宠物窗口位置失败:', error);
      }
    }
  });

  // 监听拖拽结束事件
  ipcMain.on('drag-end', (event) => {
    console.log('Drag ended');
    isDragging = false;

    if (dragInterval) {
      clearInterval(dragInterval);
      dragInterval = null;
    }

    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(false);
      petWindow.setMovable(true);
      petWindow.setFocusable(true);
    }

    // 拖动结束后进行吸附判定 - 暂时注释掉
    // performSnapCheck();

    // 延迟确保位置更新完成
    setTimeout(() => {
      console.log('Drag ended, position should be updated');
      // 可以在这里添加拖动结束后的其他逻辑
    }, 50);
  });

  // 监听手动重置状态事件（用于调试）
  ipcMain.on('manual-reset-pet-state', (event) => {
    console.log('手动重置桌宠状态');
    resetPetState();
  });

  // 监听状态查询事件
  ipcMain.on('query-pet-state', (event) => {
    const stateInfo = {
      currentEmotion: currentPetEmotion,
      hasTimer: petStateTimer !== null,
      timeRemaining: petStateTimer ? PET_STATE_DURATION : 0
    };
    console.log('当前桌宠状态:', stateInfo);
    event.reply('pet-state-info', stateInfo);
  });

  // 监听右键菜单关闭事件

  // 吸附检查函数 - 在拖动结束后执行 - 暂时注释掉
  /*
  function performSnapCheck() {
    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }
   
    try {
      const [x, y] = petWindow.getPosition();
      const [width, height] = petWindow.getSize();
   
      // 获取屏幕尺寸
      const { screen } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
   
      // 边缘吸附阈值（像素）
      const snapThreshold = 50;
   
      let newX = x;
      let newY = y;
      let snapped = false;
      let snapType = '';
      let shouldFlip = false;
   
      // 只进行屏幕边缘吸附，不吸附到其他窗口
      // 移除窗口吸附相关代码
   
      // 检测屏幕边缘吸附
      let screenSnapped = false;
   
      // 检测左边缘吸附
      if (x <= snapThreshold) {
        newX = 0;
        screenSnapped = true;
        snapType = '左边缘';
      }
      // 检测右边缘吸附
      else if (x + width >= screenWidth - snapThreshold) {
        newX = screenWidth - width;
        screenSnapped = true;
        snapType = '右边缘';
      }
   
      // 检测上边缘吸附
      if (y <= snapThreshold) {
        newY = 0;
        screenSnapped = true;
        snapType = '上边缘';
        shouldFlip = true; // 顶部吸附时翻转
      }
      // 检测下边缘吸附
      else if (y + height >= screenHeight - snapThreshold) {
        newY = screenHeight - height;
        screenSnapped = true;
        snapType = '下边缘';
      }
   
      // 特殊处理：屏幕角落吸附
      const cornerThreshold = 30;
   
      // 左上角
      if (x <= cornerThreshold && y <= cornerThreshold) {
        newX = 0;
        newY = 0;
        screenSnapped = true;
        snapType = '左上角';
        shouldFlip = true;
      }
      // 右上角
      else if (x + width >= screenWidth - cornerThreshold && y <= cornerThreshold) {
        newX = screenWidth - width;
        newY = 0;
        screenSnapped = true;
        snapType = '右上角';
        shouldFlip = true;
      }
      // 左下角
      else if (x <= cornerThreshold && y + height >= screenHeight - cornerThreshold) {
        newX = 0;
        newY = screenHeight - height;
        screenSnapped = true;
        snapType = '左下角';
      }
      // 右下角
      else if (x + width >= screenWidth - cornerThreshold && y + height >= screenHeight - cornerThreshold) {
        newX = screenWidth - width;
        newY = screenHeight - height;
        screenSnapped = true;
        snapType = '右下角';
      }
   
      
   
      // 只进行屏幕边缘吸附
      if (screenSnapped) {
        snapped = true;
        
        // 更新全局吸附状态
        isSnapped = true;
        snapInfo = {
          type: snapType,
          position: [newX, newY],
          attachedWindow: null
        };
   
        // 清除吸附窗口记录
        if (petWindow.attachedToWindow) {
          delete petWindow.attachedToWindow;
        }
      } else {
        // 没有吸附，清除吸附状态
        isSnapped = false;
        snapInfo = {
          type: '',
          position: null,
          attachedWindow: null
        };
        
        // 清除吸附窗口记录
        if (petWindow.attachedToWindow) {
          delete petWindow.attachedToWindow;
        }
      }
   
      // 如果检测到边缘吸附，移动窗口
      if (snapped) {
        petWindow.setPosition(newX, newY);
   
        console.log('边缘吸附完成:', {
          from: [x, y],
          to: [newX, newY],
          type: snapType,
          shouldFlip: shouldFlip,
          isSnapped: isSnapped
        });
   
        // 只通知渲染进程位置和翻转信息，不包含吸附类型消息
        petWindow.webContents.send('snap-completed', newX, newY, '', shouldFlip);
      } else {
        console.log('未检测到吸附，清除吸附状态');
      }
   
    } catch (error) {
      console.error('边缘吸附检查失败:', error);
    }
  }
  */

  // 监听右键菜单关闭事件
  ipcMain.on('context-menu-closed', (event) => {
    console.log('Context menu closed by user action');
    contextMenuWindow = null;
  });

  // 处理透明度调节
  ipcMain.on('set-pet-transparency', (event, transparency) => {
    try {
      // 保存当前透明度值
      currentPetTransparency = transparency;

      if (petWindow && !petWindow.isDestroyed()) {
        // 使用CSS样式而不是Electron的setOpacity方法来控制透明度
        // 将百分比转换为0-1的范围
        const opacity = transparency / 100;
        petWindow.webContents.executeJavaScript(`
          // 通过修改根元素的样式来控制透明度，避免影响其他样式
          document.documentElement.style.opacity = ${opacity};
        `);
      } else {
      }
    } catch (error) {
      console.error('Error setting pet transparency:', error);
    }
  });

  // 打开透明度控制窗口
  ipcMain.on('open-transparency-window', (event) => {
    try {
      // 关闭已存在的透明度窗口
      if (transparencyWindow && !transparencyWindow.isDestroyed()) {
        transparencyWindow.close();
        transparencyWindow = null;
      }

      // 获取右键菜单窗口位置
      let x = 0, y = 0;
      if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
        const bounds = contextMenuWindow.getBounds();
        x = bounds.x + bounds.width + 10; // 在右键菜单右侧显示
        y = bounds.y;
      }

      const newTransparencyWindow = new BrowserWindow({
        width: 160,
        height: 120,
        frame: false,
        alwaysOnTop: true,
        transparent: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          enableRemoteModule: true
        },
        movable: false,
        focusable: true,
        x: x,
        y: y,
        // 确保透明度窗口在右键菜单之上显示，但不关闭右键菜单
        parent: contextMenuWindow,
        modal: false
      });

      newTransparencyWindow.loadFile(rendererPath('transparencyWindow.html'));

      // 窗口加载完成后发送当前透明度值
      newTransparencyWindow.webContents.once('dom-ready', () => {
        newTransparencyWindow.webContents.send('current-pet-transparency', currentPetTransparency);
      });

      newTransparencyWindow.webContents.on('crashed', () => {
        console.error('Transparency window crashed');
        transparencyWindow = null;
      });

      newTransparencyWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Transparency window failed to load:', errorDescription);
        transparencyWindow = null;
      });

      newTransparencyWindow.on('closed', () => {
        transparencyWindow = null;
        console.log('Transparency window closed. Final transparency value:', currentPetTransparency);
      });

      transparencyWindow = newTransparencyWindow;
    } catch (error) {
      console.error('Error creating transparency window:', error);
    }
  });

  // 关闭透明度控制窗口
  ipcMain.on('close-transparency-window', (event) => {
    console.log('Closing transparency control window');
    try {
      if (transparencyWindow && !transparencyWindow.isDestroyed()) {
        transparencyWindow.close();
        transparencyWindow = null;
      }
    } catch (error) {
      console.error('Error closing transparency window:', error);
    }
  });

  // 监听透明度窗口关闭事件
  ipcMain.on('transparency-window-closed', (event) => {
    console.log('Transparency window closed by user action');
    transparencyWindow = null;

    // 透明度窗口关闭后，检查是否需要关闭右键菜单
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      // 延迟关闭右键菜单，给用户一些时间
      setTimeout(() => {
        if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
          console.log('Closing context menu after transparency window closed');
          contextMenuWindow.close();
        }
      }, 1000); // 1秒后关闭右键菜单
    }
  });

  // 监听透明度窗口打开事件
  ipcMain.on('transparency-window-opened', (event) => {
    console.log('Transparency window opened');
    // 通知右键菜单透明度窗口状态，并保持右键菜单打开
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      try {
        contextMenuWindow.webContents.send('transparency-window-status', true);
        // 确保右键菜单保持在前台
        contextMenuWindow.setAlwaysOnTop(true, 'screen-saver');
      } catch (error) {
        console.error('Error sending transparency window status to context menu:', error);
      }
    }
  });

  // 监听透明度窗口状态更新
  ipcMain.on('transparency-window-status', (event, isOpen) => {
    console.log('Transparency window status update:', isOpen);
    // 转发状态到右键菜单
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      try {
        contextMenuWindow.webContents.send('transparency-window-status', isOpen);
      } catch (error) {
        console.error('Error forwarding transparency window status:', error);
      }
    }
  });

  // 监听打开待办窗口请求
  ipcMain.on('open-todo-window', (event) => {
    console.log('Opening todo window from context menu');
    try {
      createTodoWindow();
    } catch (error) {
      console.error('Error opening todo window:', error);
    }
  });

  // 监听打开桌宠设置窗口请求
  ipcMain.on('open-pet-settings', (event) => {
    console.log('Opening pet settings window from context menu');
    try {
      createPetSettingsWindow();
    } catch (error) {
      console.error('Error opening pet settings window:', error);
    }
  });

  // 监听桌宠设置更新请求
  ipcMain.on('pet-settings-updated', (event, settings) => {
    console.log('Pet settings updated:', settings);
    // 更新AI服务中的桌宠设置
    updatePetSettings(settings);
  });

  // 监听打开快捷键设置窗口请求
  ipcMain.on('open-shortcut-settings', (event) => {
    console.log('Opening shortcut settings window from context menu');
    try {
      createShortcutSettingsWindow();
    } catch (error) {
      console.error('Error opening shortcut settings window:', error);
    }
  });

  // 监听快捷键更新请求
  ipcMain.on('update-shortcuts', (event, shortcuts) => {
    console.log('Updating shortcuts:', shortcuts);
    try {
      updateGlobalShortcuts(shortcuts);
    } catch (error) {
      console.error('Error updating shortcuts:', error);
    }
  });

  // 监听禁用快捷键请求
  ipcMain.on('disable-shortcuts', () => {
    console.log('Disabling global shortcuts');
    try {
      globalShortcut.unregisterAll();
    } catch (error) {
      console.error('Error disabling shortcuts:', error);
    }
  });

  // 监听启用快捷键请求
  ipcMain.on('enable-shortcuts', (event, shortcuts) => {
    console.log('Enabling global shortcuts:', shortcuts);
    try {
      updateGlobalShortcuts(shortcuts);
    } catch (error) {
      console.error('Error enabling shortcuts:', error);
    }
  });

  // 监听关闭右键菜单事件
  ipcMain.on('close-context-menu', (event) => {
    console.log('Closing context menu from external request');
    if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
      contextMenuWindow.close();
    }
  });

  // 监听关闭小黑窗口事件
  ipcMain.on('close-pet-status-window', (event) => {
    console.log('Closing pet status window from external request');
    if (petStatusWindow && !petStatusWindow.isDestroyed()) {
      petStatusWindow.close();
    }
  });

  // 监听打开聊天窗口事件
  ipcMain.on('open-chat-window', () => {
    console.log('Opening chat window');
    createChatWindow();
  });

  // 监听聊天消息发送
  ipcMain.on('chat-send-message', async (event, message) => {
    console.log('Chat message received:', message);
    chatDisplayMessages.push({ role: 'user', text: message });
    storage.save('chatHistory', chatDisplayMessages);
    try {
      const reply = await chatWithPet(message);
      chatDisplayMessages.push({ role: 'pet', text: reply });
      storage.save('chatHistory', chatDisplayMessages);
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-reply', reply);
      }
    } catch (error) {
      console.error('Error processing chat message:', error);
      const fallback = '喵呜…出了点小问题，再试一次吧～';
      chatDisplayMessages.push({ role: 'pet', text: fallback });
      storage.save('chatHistory', chatDisplayMessages);
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-reply', fallback);
      }
    }
  });

  // 监听清空聊天历史
  ipcMain.on('clear-chat-history', () => {
    clearChatHistory();
    chatDisplayMessages = [];
    storage.save('chatHistory', []);
    console.log('Chat history cleared');
  });

  // 设置窗口移动监听器
  // setupWindowMoveListener(); // 暂时注释掉

  return petWindow;
}

// 初始化第三方区域截图并接入 AI 处理
function setupScreenshots() {
  try {
    screenshots = new Screenshots({ singleWindow: false });

    screenshots.on('ok', async (e, buffer /* PNG Buffer */, bounds) => {
      try {
        pendingScreenshotBase64 = Buffer.from(buffer).toString('base64');
        createScreenshotQuestionWindow();
      } catch (err) {
        console.error('AI analyze error for region:', err);
      }
    });

    screenshots.on('cancel', () => {
      console.log('Region capture canceled');
      // 恢复默认表情
      resetPetState();
    });

    screenshots.on('error', (e, err) => {
      console.error('screenshots error:', err);
    });
  } catch (e) {
    console.error('Failed to setup electron-screenshots:', e);
  }
}

function createScreenshotQuestionWindow() {
  if (screenshotQuestionWindow && !screenshotQuestionWindow.isDestroyed()) {
    screenshotQuestionWindow.show();
    screenshotQuestionWindow.focus();
    return;
  }

  const winW = 320;
  const winH = 50;

  const display = getPetDisplay();
  const wa = display.workArea;

  let winX, winY;

  if (petWindow && !petWindow.isDestroyed()) {
    const [petX, petY] = petWindow.getPosition();
    const [petW, petH] = petWindow.getSize();
    winX = petX + petW / 2 - winW / 2;
    winY = (petY - winH - 20 >= wa.y + 10) ? petY - winH - 20 : petY + petH + 20;
    winX = Math.max(wa.x + 5, Math.min(wa.x + wa.width - winW - 5, winX));
    winY = Math.max(wa.y + 5, Math.min(wa.y + wa.height - winH - 5, winY));
  } else {
    winX = Math.round(wa.x + (wa.width - winW) / 2);
    winY = Math.round(wa.y + wa.height * 0.35);
  }

  screenshotQuestionWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: Math.round(winX),
    y: Math.round(winY),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  screenshotQuestionWindow.loadFile(rendererPath('screenshotQuestion.html'));

  screenshotQuestionWindow.on('closed', () => {
    screenshotQuestionWindow = null;
  });
}

ipcMain.on('screenshot-question-submit', async (event, question) => {
  if (screenshotQuestionWindow && !screenshotQuestionWindow.isDestroyed()) {
    screenshotQuestionWindow.close();
    screenshotQuestionWindow = null;
  }

  if (!pendingScreenshotBase64) return;

  const base64 = pendingScreenshotBase64;
  pendingScreenshotBase64 = null;

  try {
    createPetStatusWindow('让我看看...');
    const aiResponse = await analyzeScreenshot(base64, question || undefined);
    console.log('AI analysis result (region):', aiResponse);
    handleAIResponse(aiResponse);
  } catch (err) {
    console.error('AI analyze error for region:', err);
  }
});

// 统一处理AI响应到UI
function handleAIResponse(aiResponse) {
  try {
    if (!aiResponse) return;
    // 使用小黑窗口显示AI回复
    createPetStatusWindow(aiResponse.message);

    // 如果AI判断需要添加待办，则自动添加到待办列表
    if (aiResponse.actions?.todo?.shouldTrigger && aiResponse.actions.todo.content) {
      setTimeout(() => {
        addTodoFromAI(aiResponse.actions.todo.content);
      }, 1500);
    }

    // 切换宠物表情并设置状态复原
    if (aiResponse.emotion && petWindow && !petWindow.isDestroyed()) {
      try {
        petWindow.webContents.send('change-emotion', aiResponse.emotion);
        setPetState(aiResponse.emotion);
      } catch (error) {
        console.error('Failed to send emotion change:', error);
      }
    }
  } catch (e) {
    console.error('handleAIResponse error:', e);
  }
}

function addTodoFromAI(content) {
  try {
    const todos = storage.load('todos', []);
    const todo = {
      id: Date.now().toString(),
      text: content,
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    };
    todos.unshift(todo);
    storage.save('todos', todos);
    console.log('AI todo saved to file:', content);

    if (todoWindow && !todoWindow.isDestroyed()) {
      todoWindow.webContents.send('todos-updated', todos);
    }
  } catch (error) {
    console.error('Error adding todo from AI:', error);
    createPetStatusWindow(`📝 AI已识别到待办事项：${content}`);
  }
}

// 切换宠物窗口显示/隐藏
function togglePetWindow() {
  try {
    if (petWindow && !petWindow.isDestroyed()) {
      if (petWindow.isVisible()) {
        petWindow.hide();
        console.log('Pet window hidden');
      } else {
        petWindow.show();
        petWindow.focus();
        petWindow.setAlwaysOnTop(true, 'screen-saver');
        console.log('Pet window shown');
      }
    } else {
      // 如果宠物窗口不存在，创建新的
      createPetWindow();
      // 确保新创建的窗口也置顶
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      console.log('Pet window created');
    }
  } catch (error) {
    console.error('Error toggling pet window:', error);
  }
}

// 加载并注册快捷键
function loadAndRegisterShortcuts() {
  try {
    // 默认快捷键配置
    const defaultShortcuts = {
      'quick-chat': { key: 'F1', description: '快捷聊天' },
      'ai-screenshot': { key: 'F2', description: 'AI区域截图' },
      'water-reminder': { key: 'F3', description: '喝水提醒' },
      'poke-pet': { key: 'F4', description: '戳一戳小黑' },
      'open-chat': { key: 'F5', description: '打开聊天' },
      'toggle-pet': { key: 'Ctrl+H', description: '桌宠隐藏/显示' },
      'open-todo': { key: 'Ctrl+T', description: '打开待办' },
      'open-main': { key: 'Ctrl+O', description: '打开主页面' }
    };

    let shortcuts = defaultShortcuts;
    const savedShortcuts = storage.load('shortcuts', null);
    if (savedShortcuts) {
      Object.assign(shortcuts, savedShortcuts);
    }

    // 注册快捷键
    Object.entries(shortcuts).forEach(([action, config]) => {
      try {
        const key = config.key.toLowerCase();
        let accelerator = key;

        // 处理组合键
        if (key.includes('+')) {
          accelerator = key;
        } else if (key.startsWith('f') && key.length > 1) {
          // F键处理
          accelerator = key.toUpperCase();
        } else {
          accelerator = key.toUpperCase();
        }

        console.log(`Registering shortcut: ${action} -> ${accelerator}`);

        const success = globalShortcut.register(accelerator, async () => {
          await handleShortcutAction(action);
        });

        if (success) {
          console.log(`Successfully registered shortcut: ${action} -> ${accelerator}`);
        } else {
          console.error(`Failed to register shortcut: ${action} -> ${accelerator}`);
        }
      } catch (error) {
        console.error(`Error registering shortcut for ${action}:`, error);
      }
    });

    console.log('Global shortcuts loaded and registered successfully');
  } catch (error) {
    console.error('Error loading and registering shortcuts:', error);
  }
}

// 更新全局快捷键
function updateGlobalShortcuts(shortcuts) {
  try {
    // 先注销所有现有的快捷键
    globalShortcut.unregisterAll();

    // 重新注册新的快捷键
    Object.entries(shortcuts).forEach(([action, config]) => {
      try {
        const key = config.key.toLowerCase();
        let accelerator = key;

        // 处理组合键
        if (key.includes('+')) {
          accelerator = key;
        } else if (key.startsWith('f') && key.length > 1) {
          // F键处理
          accelerator = key.toUpperCase();
        } else {
          accelerator = key.toUpperCase();
        }

        console.log(`Registering shortcut: ${action} -> ${accelerator}`);

        const success = globalShortcut.register(accelerator, async () => {
          await handleShortcutAction(action);
        });

        if (success) {
          console.log(`Successfully registered shortcut: ${action} -> ${accelerator}`);
        } else {
          console.error(`Failed to register shortcut: ${action} -> ${accelerator}`);
        }
      } catch (error) {
        console.error(`Error registering shortcut for ${action}:`, error);
      }
    });

    console.log('Global shortcuts updated successfully');
  } catch (error) {
    console.error('Error updating global shortcuts:', error);
  }
}

// 处理快捷键动作
async function handleShortcutAction(action) {
  try {
    console.log(`Shortcut action triggered: ${action}`);

    switch (action) {
      case 'ai-screenshot':
        // 启动区域截图
        if (screenshots) {
          try {
            petWindow && petWindow.webContents.send('change-emotion', '好复杂');
          } catch (e) { }
          createPetStatusWindow('思考中…');
          screenshots.startCapture();
        } else {
          console.error('Screenshots not initialized');
          createPetStatusWindow('截图功能未初始化');
        }
        break;
      case 'water-reminder':
        createWaterReminderWindow();
        break;
      case 'poke-pet':
        triggerPoke();
        break;
      case 'quick-chat':
        createQuickChatWindow();
        break;
      case 'open-chat':
        createChatWindow();
        break;
      case 'toggle-pet':
        togglePetWindow();
        break;
      case 'open-todo':
        createTodoWindow();
        break;
      case 'open-main':
        // 使用与右键菜单相同的逻辑
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
        break;
      default:
        console.log(`Unknown shortcut action: ${action}`);
    }
  } catch (error) {
    console.error(`Error handling shortcut action ${action}:`, error);
  }
}

// 显示趣味提醒
async function showFunReminder() {
  try {
    // 生成AI趣味提醒
    const funMessage = await generateFunReminder();
    createPetStatusWindow(funMessage);
  } catch (error) {
    console.error('Error showing fun reminder:', error);
    // 如果生成失败，显示默认消息
    createPetStatusWindow('今天也要开开心心的哦！✨');
  }
}

// 创建宠物状态弹窗窗口
function createPetStatusWindow(message) {
  console.log('Creating pet status window with message:', message);

  // 关闭已存在的小黑窗口
  if (petStatusWindow && !petStatusWindow.isDestroyed()) {
    console.log('Closing existing pet status window');
    try {
      petStatusWindow.close();
      petStatusWindow = null;
    } catch (error) {
      console.error('Error closing existing pet status window:', error);
      petStatusWindow = null;
    }
  }

  const newPetStatusWindow = new BrowserWindow({
    width: 220,
    height: 120,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    movable: false,
    focusable: true,
    hasShadow: false
  });

  newPetStatusWindow.loadFile(rendererPath('petStatus.html'));

  // 智能计算弹窗位置，兼容多屏
  const display = getPetDisplay();
  const workArea = display.workArea;
  const screenWidth = workArea.width;
  const screenHeight = workArea.height;
  const screenX = workArea.x;
  const screenY = workArea.y;

  // 获取宠物窗口位置和大小
  let petPosition, petSize;

  if (petWindow && !petWindow.isDestroyed()) {
    try {
      petPosition = petWindow.getPosition();
      petSize = petWindow.getSize();

      if (petPosition && Array.isArray(petPosition) && petPosition.length === 2 &&
        petSize && Array.isArray(petSize) && petSize.length === 2) {
        console.log('Pet window position:', petPosition, 'size:', petSize);
      } else {
        throw new Error('Invalid position or size data');
      }
    } catch (error) {
      console.error('Error getting pet window position:', error);
      petPosition = [screenX + screenWidth - 120, screenY + screenHeight - 120];
      petSize = [100, 100];
    }
  } else {
    petPosition = [screenX + screenWidth - 120, screenY + screenHeight - 120];
    petSize = [100, 100];
    console.log('Using default pet position:', petPosition);
  }

  // 气泡窗口的尺寸
  const bubbleWidth = 220;
  const bubbleHeight = 120;
  const bubbleTailHeight = 16; // 尾巴的高度

  // 计算最佳位置
  let bubbleX, bubbleY, bubbleDirection;

  // 计算桌宠中心位置
  const petCenterX = petPosition[0] + (petSize[0] / 2);
  const petCenterY = petPosition[1] + (petSize[1] / 2);

  // 屏幕绝对边界
  const sLeft = screenX;
  const sTop = screenY;
  const sRight = screenX + screenWidth;
  const sBottom = screenY + screenHeight;

  // 优先尝试上方位置
  if (petPosition[1] - bubbleHeight - bubbleTailHeight >= sTop + 10) {
    bubbleX = petCenterX - (bubbleWidth / 2);
    bubbleY = petPosition[1] - bubbleHeight - bubbleTailHeight;
    bubbleDirection = 'top';
  } else if (petPosition[1] + petSize[1] + bubbleHeight + bubbleTailHeight <= sBottom) {
    bubbleX = petCenterX - (bubbleWidth / 2);
    bubbleY = petPosition[1] + petSize[1] + bubbleTailHeight;
    bubbleDirection = 'bottom';
  } else if (petPosition[0] - bubbleWidth - bubbleTailHeight >= sLeft + 10) {
    bubbleX = petPosition[0] - bubbleWidth - bubbleTailHeight;
    bubbleY = petCenterY - (bubbleHeight / 2);
    bubbleDirection = 'left';
  } else if (petPosition[0] + petSize[0] + bubbleWidth + bubbleTailHeight <= sRight) {
    bubbleX = petPosition[0] + petSize[0] + bubbleTailHeight;
    bubbleY = petCenterY - (bubbleHeight / 2);
    bubbleDirection = 'right';
  } else {
    bubbleX = Math.max(sLeft + 10, Math.min(sRight - bubbleWidth - 10, petCenterX - (bubbleWidth / 2)));
    bubbleY = Math.max(sTop + 10, petPosition[1] - bubbleHeight - bubbleTailHeight);
    bubbleDirection = 'top';
  }

  // 确保气泡不会超出当前屏幕边界
  bubbleX = Math.max(sLeft + 10, Math.min(sRight - bubbleWidth - 10, bubbleX));
  bubbleY = Math.max(sTop + 10, Math.min(sBottom - bubbleHeight - 10, bubbleY));

  console.log(`Positioning bubble at (${bubbleX}, ${bubbleY}) direction: ${bubbleDirection}, display: ${display.id}`);

  newPetStatusWindow.setPosition(Math.round(bubbleX), Math.round(bubbleY));

  // 通过IPC传递消息和气泡方向
  newPetStatusWindow.webContents.once('dom-ready', () => {
    try {
      console.log('Sending message and direction to status window:', message, bubbleDirection);
      newPetStatusWindow.webContents.send('update-status-message', message);
      newPetStatusWindow.webContents.send('set-bubble-direction', bubbleDirection);
    } catch (error) {
      console.error('Error sending message to status window:', error);
    }
  });

  // 监听窗口错误
  newPetStatusWindow.webContents.on('crashed', () => {
    console.error('Status window crashed');
    petStatusWindow = null;
  });

  newPetStatusWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Status window failed to load:', errorCode, errorDescription);
    petStatusWindow = null;
  });

  // 监听窗口关闭事件
  newPetStatusWindow.on('closed', () => {
    console.log('Pet status window closed');
    petStatusWindow = null;
  });

  // 监听窗口失去焦点事件（点击外部关闭）
  newPetStatusWindow.on('blur', () => {
    console.log('Pet status window lost focus, closing');
    if (newPetStatusWindow && !newPetStatusWindow.isDestroyed()) {
      newPetStatusWindow.close();
    }
  });

  // 保存到全局变量
  petStatusWindow = newPetStatusWindow;

  return newPetStatusWindow;
}

// 创建聊天窗口
function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return chatWindow;
  }

  const display = getPetDisplay();
  const wa = display.workArea;

  let winX = wa.x + wa.width - 380;
  let winY = wa.y + wa.height - 560;

  if (petWindow && !petWindow.isDestroyed()) {
    const [petX, petY] = petWindow.getPosition();
    winX = petX - 330;
    winY = petY - 420;

    if (winX < wa.x + 10) winX = petX + 110;
    if (winY < wa.y + 10) winY = wa.y + 10;
    if (winX + 320 > wa.x + wa.width) winX = wa.x + wa.width - 330;
    if (winY + 500 > wa.y + wa.height) winY = wa.y + wa.height - 510;
  }

  chatWindow = new BrowserWindow({
    width: 320,
    height: 500,
    x: winX,
    y: winY,
    frame: false,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  chatWindow.loadFile(rendererPath('chatWindow.html'));

  chatWindow.webContents.once('dom-ready', () => {
    const petSettings = getCurrentPetSettings();
    chatWindow.webContents.send('set-pet-name', petSettings.petName);
    if (chatDisplayMessages.length > 0) {
      chatWindow.webContents.send('chat-restore-history', chatDisplayMessages);
    }
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });

  return chatWindow;
}

// 快捷聊天窗口
let quickChatWindow = null;
let quickChatHistory = [];
let quickChatLastTime = 0;
const QUICK_CHAT_CONTEXT_TTL = 5 * 60 * 1000; // 5分钟上下文过期

function createQuickChatWindow() {
  if (quickChatWindow && !quickChatWindow.isDestroyed()) {
    quickChatWindow.show();
    quickChatWindow.focus();
    return;
  }

  const winW = 280;
  const winH = 50;

  const display = getPetDisplay();
  const wa = display.workArea;
  const sLeft = wa.x;
  const sTop = wa.y;
  const sRight = wa.x + wa.width;
  const sBottom = wa.y + wa.height;

  let winX, winY;

  if (petWindow && !petWindow.isDestroyed()) {
    const [petX, petY] = petWindow.getPosition();
    const [petW, petH] = petWindow.getSize();
    const petCenterX = petX + petW / 2;

    winX = petCenterX - winW / 2;

    if (petY - winH - 20 >= sTop + 10) {
      winY = petY - winH - 20;
    } else {
      winY = petY + petH + 20;
    }

    winX = Math.max(sLeft + 5, Math.min(sRight - winW - 5, winX));
    winY = Math.max(sTop + 5, Math.min(sBottom - winH - 5, winY));
  } else {
    winX = Math.round(sLeft + (wa.width - winW) / 2);
    winY = Math.round(sTop + wa.height * 0.35);
  }

  quickChatWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: Math.round(winX),
    y: Math.round(winY),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  quickChatWindow.loadFile(rendererPath('quickChat.html'));

  quickChatWindow.on('blur', () => {
    if (quickChatWindow && !quickChatWindow.isDestroyed()) {
      quickChatWindow.close();
    }
  });

  quickChatWindow.on('closed', () => {
    quickChatWindow = null;
  });
}

ipcMain.on('quick-chat-send', async (event, userMessage) => {
  if (quickChatWindow && !quickChatWindow.isDestroyed()) {
    quickChatWindow.close();
  }

  const now = Date.now();
  if (now - quickChatLastTime > QUICK_CHAT_CONTEXT_TTL) {
    quickChatHistory = [];
  }
  quickChatLastTime = now;

  quickChatHistory.push({ role: 'user', content: userMessage });
  if (quickChatHistory.length > 10) {
    quickChatHistory = quickChatHistory.slice(-10);
  }

  try {
    const reply = await chatWithPet(userMessage);
    quickChatHistory.push({ role: 'assistant', content: reply });

    createPetStatusWindow(reply);

    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('change-emotion', '嘿嘿被夸了');
      setTimeout(() => {
        if (petWindow && !petWindow.isDestroyed()) {
          petWindow.webContents.send('reset-emotion');
        }
      }, 4000);
    }
  } catch (error) {
    console.error('Quick chat error:', error);
    createPetStatusWindow('喵…好像出了点问题');
  }
});

ipcMain.on('quick-chat-close', () => {
  if (quickChatWindow && !quickChatWindow.isDestroyed()) {
    quickChatWindow.close();
  }
});

// 创建右键菜单窗口
function createContextMenuWindow(x, y, petPosition = [0, 0]) {
  // 关闭已存在的右键菜单
  if (contextMenuWindow && !contextMenuWindow.isDestroyed()) {
    console.log('Closing existing context menu window');
    try {
      contextMenuWindow.close();
      contextMenuWindow = null;
    } catch (error) {
      console.error('Error closing existing context menu:', error);
      contextMenuWindow = null;
    }
  }

  const newContextMenuWindow = new BrowserWindow({
    width: 180,
    height: 220,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    movable: false,
    focusable: true,
    // 确保右键菜单在桌宠之上显示
    parent: petWindow,
    modal: false
  });

  newContextMenuWindow.loadFile(rendererPath('contextMenu.html'));

  // 智能定位，兼容多屏
  const display = getPetDisplay();
  const wa = display.workArea;

  const menuWidth = 180;
  const menuHeight = 220;

  let finalX = x;
  let finalY = y;

  // 水平方向调整
  if (finalX + menuWidth > wa.x + wa.width) {
    finalX = wa.x + wa.width - menuWidth - 10;
  }
  if (finalX < wa.x + 10) {
    finalX = wa.x + 10;
  }

  // 垂直方向调整
  const [petX, petY] = petPosition;
  const spaceAbove = y - wa.y;
  const spaceBelow = (wa.y + wa.height) - y - menuHeight;

  if (spaceAbove >= menuHeight + 20) {
    finalY = y - menuHeight - 10;
  } else if (spaceBelow >= menuHeight + 20) {
    finalY = y + 20;
  } else {
    if (y + menuHeight > wa.y + wa.height) {
      finalY = wa.y + wa.height - menuHeight - 10;
    }
    if (finalY < wa.y + 10) {
      finalY = wa.y + 10;
    }
  }

  console.log(`Context menu positioning: original(${x}, ${y}), pet(${petX}, ${petY}) -> final(${finalX}, ${finalY})`);
  newContextMenuWindow.setPosition(finalX, finalY);

  // 错误处理
  newContextMenuWindow.webContents.on('crashed', () => {
    console.error('Context menu window crashed');
  });
  newContextMenuWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Context menu window failed to load:', errorCode, errorDescription);
  });

  // 监听窗口关闭事件，清理全局变量
  newContextMenuWindow.on('closed', () => {
    contextMenuWindow = null;
    console.log('Context menu window closed, global variable cleared');
  });

  // 监听窗口即将关闭事件
  newContextMenuWindow.on('close', () => {
    console.log('Context menu window closing...');
  });

  // 自动关闭功能 - 只有在没有透明度窗口打开时才自动关闭
  setTimeout(() => {
    try {
      if (newContextMenuWindow && !newContextMenuWindow.isDestroyed()) {
        // 检查是否有透明度窗口打开
        if (!transparencyWindow || transparencyWindow.isDestroyed()) {
          console.log('Auto-closing context menu window (no transparency window open)');
          newContextMenuWindow.close();
        } else {
          console.log('Keeping context menu open (transparency window is active)');
        }
      }
    } catch (error) {
      console.error('Error auto-closing context menu window:', error);
    }
  }, 5000); // 5秒后自动关闭

  // 更新全局变量
  contextMenuWindow = newContextMenuWindow;
  return newContextMenuWindow;
}

// 设置全局点击处理器来关闭右键菜单
function setupGlobalClickHandler() {
  if (!contextMenuWindow || contextMenuWindow.isDestroyed()) {
    return;
  }

  console.log('Setting up global click handler for context menu');

  // 简化版本：直接使用定时器检查右键菜单状态
  const checkInterval = setInterval(() => {
    if (!contextMenuWindow || contextMenuWindow.isDestroyed()) {
      clearInterval(checkInterval);
      console.log('Context menu closed, clearing click handler');
    }
  }, 100);

  // 5秒后自动清理
  setTimeout(() => {
    clearInterval(checkInterval);
  }, 5000);
}


// 清理文本中的乱码字符
function cleanText(text) {
  if (!text) return text;

  // 移除常见的乱码字符
  return text.replace(/[^\x20-\x7E\u4e00-\u9fa5]/g, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5\s\-_]/g, '')
    .trim();
}

// 创建通知气泡窗口
function createBubbleWindow(message) {
  bubbleWindow = new BrowserWindow({
    width: 300,
    height: 100,
    frame: false,
    alwaysOnTop: true,
    transparent: false, // 禁用透明度以提高兼容性
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  bubbleWindow.loadFile(rendererPath('bubble.html'));

  // 通过IPC将AI生成的消息传递给气泡窗口
  bubbleWindow.webContents.once('dom-ready', () => {
    bubbleWindow.webContents.send('update-bubble-message', message);
  });

  return bubbleWindow;
}

// 创建喝水提醒窗口（持久弹窗，带交互按钮）
function createWaterReminderWindow() {
  try {
    if (waterReminderWindow && !waterReminderWindow.isDestroyed()) {
      waterReminderWindow.show();
      waterReminderWindow.focus();
      return waterReminderWindow;
    }

    waterReminderWindow = new BrowserWindow({
      width: 640,
      height: 520,
      frame: false,
      alwaysOnTop: true,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      movable: true,
      focusable: true
    });

    waterReminderWindow.loadFile(rendererPath('waterReminder.html'));

    // 将窗口置于桌宠所在屏幕中央
    const wrDisplay = getPetDisplay();
    const wrWA = wrDisplay.workArea;
    waterReminderWindow.setPosition(
      Math.round(wrWA.x + (wrWA.width - 640) / 2),
      Math.round(wrWA.y + (wrWA.height - 520) / 2)
    );

    // 不因失焦自动关闭，直到用户点击按钮
    waterReminderWindow.on('closed', () => {
      waterReminderWindow = null;
    });

    return waterReminderWindow;
  } catch (error) {
    console.error('Error creating water reminder window:', error);
    // 兜底：使用小黑窗口展示消息
    const waterMessage = '💧 该喝水啦！记得保持水分补充哦～';
    createPetStatusWindow(waterMessage);
  }
}

// 创建待办窗口
function createTodoWindow() {
  try {
    if (todoWindow && !todoWindow.isDestroyed()) {
      todoWindow.show();
      todoWindow.focus();
      return todoWindow;
    }

    todoWindow = new BrowserWindow({
      width: 800,
      height: 700,
      frame: false,
      alwaysOnTop: false,
      resizable: true,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      movable: true,
      focusable: true,
      show: false
    });

    todoWindow.loadFile(rendererPath('todoWindow.html'));

    const tdDisplay = getPetDisplay();
    const tdWA = tdDisplay.workArea;
    todoWindow.setPosition(
      Math.round(tdWA.x + (tdWA.width - 800) / 2),
      Math.round(tdWA.y + (tdWA.height - 700) / 2)
    );

    todoWindow.once('ready-to-show', () => {
      todoWindow.show();
    });

    todoWindow.on('closed', () => {
      todoWindow = null;
    });

    return todoWindow;
  } catch (error) {
    console.error('Error creating todo window:', error);
  }
}

// 创建桌宠设置窗口
function createPetSettingsWindow() {
  try {
    if (petSettingsWindow && !petSettingsWindow.isDestroyed()) {
      petSettingsWindow.show();
      petSettingsWindow.focus();
      return petSettingsWindow;
    }

    petSettingsWindow = new BrowserWindow({
      width: 500,
      height: 700,
      frame: false,
      alwaysOnTop: false,
      resizable: true,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      movable: true,
      focusable: true,
      show: false
    });

    petSettingsWindow.loadFile(rendererPath('petSettings.html'));

    const psDisplay = getPetDisplay();
    const psWA = psDisplay.workArea;
    petSettingsWindow.setPosition(
      Math.round(psWA.x + (psWA.width - 500) / 2),
      Math.round(psWA.y + (psWA.height - 700) / 2)
    );

    petSettingsWindow.once('ready-to-show', () => {
      petSettingsWindow.show();
    });

    petSettingsWindow.on('closed', () => {
      petSettingsWindow = null;
    });

    return petSettingsWindow;
  } catch (error) {
    console.error('Error creating pet settings window:', error);
  }
}

function checkAndShowPetSettingsOnStartup() {
  const settings = storage.load('settings', null);
  if (!settings || !settings.petName) {
    console.log('首次启动，显示桌宠设置窗口');
    setTimeout(() => createPetSettingsWindow(), 2000);
  } else {
    console.log('桌宠已设置，跳过设置窗口');
    updatePetSettings({ petName: settings.petName, petCharacter: settings.petCharacter });
    if (settings.apiKey) {
      config.setApiKey(settings.apiKey);
    }
  }
}

// 创建快捷键设置窗口
function createShortcutSettingsWindow() {
  try {
    if (shortcutSettingsWindow && !shortcutSettingsWindow.isDestroyed()) {
      shortcutSettingsWindow.show();
      shortcutSettingsWindow.focus();
      return shortcutSettingsWindow;
    }

    shortcutSettingsWindow = new BrowserWindow({
      width: 600,
      height: 700,
      frame: false,
      alwaysOnTop: false,
      resizable: true,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true
      },
      movable: true,
      focusable: true,
      show: false
    });

    shortcutSettingsWindow.loadFile(rendererPath('shortcutSettings.html'));

    const ssDisplay = getPetDisplay();
    const ssWA = ssDisplay.workArea;
    shortcutSettingsWindow.setPosition(
      Math.round(ssWA.x + (ssWA.width - 600) / 2),
      Math.round(ssWA.y + (ssWA.height - 700) / 2)
    );

    shortcutSettingsWindow.once('ready-to-show', () => {
      shortcutSettingsWindow.show();
    });

    shortcutSettingsWindow.on('closed', () => {
      shortcutSettingsWindow = null;
    });

    return shortcutSettingsWindow;
  } catch (error) {
    console.error('Error creating shortcut settings window:', error);
  }
}

// 启动待办提醒系统
function startTodoReminder() {
  if (todoReminderTimer) {
    clearInterval(todoReminderTimer);
  }

  todoReminderTimer = setInterval(() => {
    checkAndShowTodoReminder();
  }, TODO_REMINDER_INTERVAL);

  console.log('Todo reminder system started');
}

// 停止待办提醒系统
function stopTodoReminder() {
  if (todoReminderTimer) {
    clearInterval(todoReminderTimer);
    todoReminderTimer = null;
  }
  console.log('Todo reminder system stopped');
}

// 检查并显示待办提醒
function checkAndShowTodoReminder() {
  try {
    const now = Date.now();
    if (now - lastTodoReminderTime > TODO_REMINDER_INTERVAL) {
      lastTodoReminderTime = now;

      // 显示待办提醒
      const reminderMessage = '📝 记得查看你的待办事项哦！';
      createPetStatusWindow(reminderMessage);

      console.log('Todo reminder shown');
    }
  } catch (error) {
    console.error('Error showing todo reminder:', error);
  }
}

// 截图功能已改为使用第三方区域截图库
// 不再需要全屏截图功能

// 注册全局快捷键监听截图
function registerScreenshotListener() {
  // 加载自定义快捷键设置
  loadAndRegisterShortcuts();

  try {
    // 先注销可能已注册的快捷键
    globalShortcut.unregister('F6');

    // 注册手动重置状态快捷键
    const ret4 = globalShortcut.register('F6', () => {
      console.log('Manual reset pet state triggered!');
      resetPetState();
    });

    if (!ret4) {
      console.log('Reset pet state listener registration failed');
    } else {
      console.log('Reset pet state listener registered successfully');
    }
  } catch (error) {
    console.log('Reset pet state listener registration error:', error);
  }
}

// 移除自研区域选择器的 IPC 交互（改用 electron-screenshots）

// 显示截图响应气泡（放置在右上角）
function showScreenshotBubble(message) {
  const bubbleWindow = createBubbleWindow(message);

  // 设置气泡窗口位置到桌宠所在屏幕右上角
  const display = getPetDisplay();
  const wa = display.workArea;

  bubbleWindow.setPosition(
    wa.x + wa.width - 310,
    wa.y + 150
  );

  // 10秒后自动关闭
  setTimeout(() => {
    if (bubbleWindow && !bubbleWindow.isDestroyed()) {
      bubbleWindow.close();
    }
  }, 10000);
}

// IPC事件处理：用户活动
ipcMain.on('user-activity', () => {
  if (activityMonitor) {
    activityMonitor.updateActivity();
  }
});

// IPC事件处理：确认喝水
ipcMain.on('water-confirmed', () => {
  if (waterReminderWindow) {
    waterReminderWindow.close();
  }
  console.log('User confirmed drinking water');
});

// IPC事件处理：延迟喝水提醒
ipcMain.on('water-delayed', () => {
  if (waterReminderWindow) {
    waterReminderWindow.close();
  }
  console.log('User delayed drinking water reminder');
});

// IPC事件处理：手动触发喝水提醒
ipcMain.on('manual-water-reminder', () => {
  createWaterReminderWindow();
});

// IPC事件处理：手动触发趣味提醒
ipcMain.on('manual-fun-reminder', async () => {
  await showFunReminder();
});

// ====== 统一文件存储 IPC ======
ipcMain.handle('storage-load', (event, name, fallback) => {
  return storage.load(name, fallback);
});

ipcMain.handle('storage-save', (event, name, data) => {
  return storage.save(name, data);
});

ipcMain.on('save-settings', (event, settings) => {
  storage.save('settings', settings);
  if (settings.apiKey !== undefined) {
    config.setApiKey(settings.apiKey);
  }
  if (settings.petName || settings.petCharacter) {
    updatePetSettings({ petName: settings.petName, petCharacter: settings.petCharacter });
  }
});

ipcMain.handle('load-settings', () => {
  return storage.load('settings', {});
});

ipcMain.on('save-todos', (event, todos) => {
  storage.save('todos', todos);
});

ipcMain.handle('load-todos', () => {
  return storage.load('todos', []);
});

ipcMain.on('save-shortcuts', (event, shortcuts) => {
  storage.save('shortcuts', shortcuts);
});

ipcMain.handle('load-shortcuts', () => {
  return storage.load('shortcuts', null);
});

ipcMain.on('save-chat-history', (event, messages) => {
  storage.save('chatHistory', messages);
});

ipcMain.handle('load-chat-history', () => {
  return storage.load('chatHistory', []);
});

ipcMain.on('add-todo-from-ai', (event, content) => {
  addTodoFromAI(content);
});

// ====== 统一文件存储 IPC END ======

// 应用准备就绪时执行
app.whenReady().then(() => {
  // 从文件加载持久化数据
  config.loadApiKeyFromStorage();
  chatDisplayMessages = storage.load('chatHistory', []);

  // 等待一会儿再注册快捷键，避免冲突
  setTimeout(() => {
    createMainWindow();
    createPetWindow(); // 创建宠物窗口
    setupScreenshots(); // 初始化第三方区域截屏
    registerScreenshotListener();

    // 注入弹窗创建函数给ActivityMonitor
    setCreatePetStatusWindowFunction(createPetStatusWindow);
    setCreateWaterReminderWindowFunction(createWaterReminderWindow);
    activityMonitor = new ActivityMonitor();

    // 启动待办提醒系统
    startTodoReminder();

    // 初始化主动人格引擎
    proactiveEngine.init({
      showMessage: (msg) => createPetStatusWindow(msg),
      changeEmotion: (emotion) => {
        if (petWindow && !petWindow.isDestroyed()) {
          if (emotion) {
            petWindow.webContents.send('change-emotion', emotion);
          } else {
            petWindow.webContents.send('reset-emotion');
          }
        }
      }
    });

    // 检查是否需要显示桌宠设置窗口（首次启动时）
    checkAndShowPetSettingsOnStartup();
  }, 1000);
}).catch(err => {
  console.error('Failed to initialize app:', err);
});

// 应用激活时创建窗口（macOS）
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// 关闭所有窗口时退出应用（Windows & Linux）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 注销快捷键监听
app.on('will-quit', () => {
  globalShortcut.unregisterAll();

  // 清理活动监控
  if (activityMonitor) {
    activityMonitor.destroy();
  }

  // 清理主动人格引擎
  proactiveEngine.destroy();

  // 停止待办提醒系统
  stopTodoReminder();

});

// 窗口移动监听器 - 暂时注释掉
/*
function setupWindowMoveListener() {
  // 由于只进行屏幕边缘吸附，不再需要窗口跟随功能
  // 保留函数结构以便将来扩展
  console.log('窗口跟随功能已禁用，只进行屏幕边缘吸附');
}
*/

// 清除吸附状态的函数 - 暂时注释掉
/*
function clearSnapState() {
  console.log('清除吸附状态');
  isSnapped = false;
  snapInfo = {
    type: '',
    position: null,
    attachedWindow: null
  };
  
  if (petWindow && petWindow.attachedToWindow) {
    delete petWindow.attachedToWindow;
  }
}
*/

// 设置桌宠状态并启动复原计时器
function setPetState(emotion) {
  // 清除之前的计时器
  if (petStateTimer) {
    clearTimeout(petStateTimer);
  }

  currentPetEmotion = emotion;
  console.log('设置桌宠状态:', emotion);

  // 设置复原计时器
  petStateTimer = setTimeout(() => {
    resetPetState();
  }, PET_STATE_DURATION);
}

// 重置桌宠状态为初始状态
function resetPetState() {
  if (petWindow && !petWindow.isDestroyed()) {
    try {
      // 发送重置状态信号给渲染进程
      petWindow.webContents.send('reset-emotion');
      console.log('重置桌宠状态为初始状态');

      // 清除状态记录
      currentPetEmotion = null;
      if (petStateTimer) {
        clearTimeout(petStateTimer);
        petStateTimer = null;
      }
    } catch (error) {
      console.error('重置桌宠状态失败:', error);
    }
  }
}
