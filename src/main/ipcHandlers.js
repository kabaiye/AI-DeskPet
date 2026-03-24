/**
 * IPC 事件处理 — 集中注册所有 ipcMain 事件
 */
const path = require('path');
const fs = require('fs');
const { ipcMain, globalShortcut, app } = require('electron');
const state = require('./appState');
const storage = require('./storageService');
const config = require('./config');
const cs = require('./characterService');
const { analyzeScreenshot, generateFunReminder, generatePokeReaction,
  updatePetSettings, chatWithPet, clearChatHistory, generateDiary } = require('./aiService');
const wm = require('./windowManager');
const sm = require('./shortcutManager');
const diary = require('./diaryService');
const { handleError, getFriendlyMessage } = require('./errorHandler');

function parseScheduleFromReply(reply) {
  const regex = /\/addSchedule\s+(.+)/;
  const match = reply.match(regex);
  if (!match) return { displayReply: reply, scheduleContent: null, reminderTime: null };

  const displayReply = reply.replace(regex, '').trim();
  const payload = match[1].trim();
  const parts = payload.split('||');
  const scheduleContent = parts[0].trim();
  const reminderTime = parts[1] ? parts[1].trim() : null;
  return { displayReply, scheduleContent, reminderTime };
}

function addTodoFromAI(content, reminderTime) {
  const todos = storage.load('todos', []);
  const newTodo = {
    id: Date.now(),
    text: content,
    completed: false,
    createdAt: new Date().toISOString(),
    source: 'ai'
  };
  if (reminderTime) newTodo.reminderTime = reminderTime;
  todos.push(newTodo);
  storage.save('todos', todos);
  diary.recordEvent('todoAdded');
  console.log('AI added todo:', content, reminderTime ? `remind at ${reminderTime}` : '');

  if (reminderTime) {
    scheduleTodoReminder(newTodo.id.toString(), content, reminderTime);
  }
}

function scheduleTodoReminder(todoId, text, reminderTimeISO) {
  const ms = new Date(reminderTimeISO).getTime() - Date.now();
  if (ms <= 0) return;

  if (state.todoReminderTimers.has(todoId)) {
    clearTimeout(state.todoReminderTimers.get(todoId));
  }

  const timer = setTimeout(() => {
    state.todoReminderTimers.delete(todoId);
    wm.createPersistentReminder(`⏰ 提醒：${text}`);
    if (state.petWindow && !state.petWindow.isDestroyed()) {
      state.petWindow.webContents.send('change-emotion', '好复杂');
      setTimeout(() => {
        if (state.petWindow && !state.petWindow.isDestroyed()) {
          state.petWindow.webContents.send('reset-emotion');
        }
      }, 6000);
    }
  }, ms);

  state.todoReminderTimers.set(todoId, timer);
}

function restoreTodoReminders() {
  const todos = storage.load('todos', []);
  todos.forEach(t => {
    if (t.reminderTime && !t.completed) {
      scheduleTodoReminder(t.id.toString(), t.text, t.reminderTime);
    }
  });
}

/** 处理聊天回复的公共逻辑（chat-send-message 和 quick-chat-send 共用） */
async function processChatReply(userMessage, { onReply, onError, saveToHistory = false }) {
  try {
    const rawReply = await chatWithPet(userMessage);
    const { displayReply, scheduleContent, reminderTime } = parseScheduleFromReply(rawReply);

    if (onReply) onReply(displayReply);

    if (scheduleContent) {
      console.log('Detected schedule:', scheduleContent, 'reminder:', reminderTime);
      addTodoFromAI(scheduleContent, reminderTime);
      const timeHint = reminderTime
        ? `（提醒：${new Date(reminderTime).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）`
        : '';
      setTimeout(() => {
        wm.createPetStatusWindow(`📝 已添加待办：${scheduleContent}${timeHint}`);
      }, 1500);
    }
  } catch (error) {
    handleError(error, '聊天');
    if (onError) onError(error);
  }
}

function triggerPoke() {
  state.pokeCount++;
  if (state.pokeResetTimer) clearTimeout(state.pokeResetTimer);
  state.pokeResetTimer = setTimeout(() => { state.pokeCount = 0; }, state.POKE_COUNT_RESET_MS);

  if (state.pokeDebounceTimer) clearTimeout(state.pokeDebounceTimer);
  if (state.pokeProcessing) return;

  state.pokeDebounceTimer = setTimeout(async () => {
    if (state.pokeProcessing) return;
    state.pokeProcessing = true;
    diary.recordEvent('poke');
    try {
      const count = state.pokeCount;
      const { message, emotion } = await generatePokeReaction(count);
      diary.recordChatLog('poke', `戳了第${count}次`, message);
      wm.createPetStatusWindow(message);
      if (emotion && state.petWindow && !state.petWindow.isDestroyed()) {
        diary.recordEvent('emotion', { emotion });
        state.petWindow.webContents.send('change-emotion', emotion);
        setTimeout(() => {
          if (state.petWindow && !state.petWindow.isDestroyed()) {
            state.petWindow.webContents.send('reset-emotion');
          }
        }, 4000);
      }
    } catch (err) {
      handleError(err, '戳一戳', wm.createPetStatusWindow);
    } finally {
      state.pokeProcessing = false;
    }
  }, state.POKE_DEBOUNCE_MS);
}

function setPetState(emotion) {
  if (state.petStateTimer) clearTimeout(state.petStateTimer);
  state.currentPetEmotion = emotion;
  state.petStateTimer = setTimeout(() => resetPetState(), state.PET_STATE_DURATION);
}

function resetPetState() {
  if (state.petWindow && !state.petWindow.isDestroyed()) {
    try {
      state.petWindow.webContents.send('reset-emotion');
      state.currentPetEmotion = null;
      if (state.petStateTimer) { clearTimeout(state.petStateTimer); state.petStateTimer = null; }
    } catch (err) {
      handleError(err, '重置桌宠状态');
    }
  }
}

function startTodoReminder() {
  if (state.todoReminderTimer) clearInterval(state.todoReminderTimer);
  state.todoReminderTimer = setInterval(() => {
    const now = Date.now();
    if (now - state.lastTodoReminderTime > state.TODO_REMINDER_INTERVAL) {
      state.lastTodoReminderTime = now;
      wm.createPetStatusWindow('📝 记得查看你的待办事项哦！');
    }
  }, state.TODO_REMINDER_INTERVAL);
}

function stopTodoReminder() {
  if (state.todoReminderTimer) { clearInterval(state.todoReminderTimer); state.todoReminderTimer = null; }
}

/** 创建快捷键动作映射 */
function buildActionHandlers() {
  return {
    'quick-chat': () => wm.createQuickChatWindow(),
    'ai-screenshot': () => {
      if (state.screenshots) {
        try {
          state.petWindow && state.petWindow.webContents.send('change-emotion', '好复杂');
        } catch (_) { /* ignore */ }
        wm.createPetStatusWindow('思考中…');
        state.screenshots.startCapture();
      } else {
        wm.createPetStatusWindow('截图功能未初始化');
      }
    },
    'water-reminder': () => wm.createWaterReminderWindow(),
    'poke-pet': () => triggerPoke(),
    'open-chat': () => wm.createChatWindow(),
    'toggle-pet': () => wm.togglePetWindow(),
    'open-todo': () => wm.createTodoWindow(),
    'open-main': () => {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.show();
        state.mainWindow.focus();
      } else {
        wm.createMainWindow();
      }
    }
  };
}

function registerAll() {
  const actionHandlers = buildActionHandlers();

  // === 桌宠交互 ===
  ipcMain.on('pet-clicked', () => triggerPoke());

  ipcMain.on('open-main-window', () => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.show(); state.mainWindow.focus();
      } else { wm.createMainWindow(); }
    } catch (err) { handleError(err, '打开主窗口', wm.createPetStatusWindow); }
  });

  ipcMain.on('exit-app', () => {
    app.isQuitting = true;
    app.quit();
  });

  ipcMain.on('show-context-menu', (event, x, y) => {
    try {
      wm.createContextMenuWindow(x, y);
    } catch (err) { handleError(err, '右键菜单'); }
  });

  ipcMain.on('get-pet-window-position', (event) => {
    if (state.petWindow && !state.petWindow.isDestroyed()) {
      const [x, y] = state.petWindow.getPosition();
      event.reply('pet-window-position', x, y);
    }
  });

  // === 拖拽 ===
  ipcMain.on('drag-start', (event, { offsetX, offsetY }) => {
    state.isDragging = true;
    state.dragOffset = { x: offsetX, y: offsetY };
    if (state.dragInterval) { clearInterval(state.dragInterval); state.dragInterval = null; }

    const { screen } = require('electron');
    state.dragInterval = setInterval(() => {
      if (!state.isDragging || !state.petWindow || state.petWindow.isDestroyed()) {
        clearInterval(state.dragInterval); state.dragInterval = null; return;
      }
      const cursor = screen.getCursorScreenPoint();
      state.petWindow.setPosition(Math.round(cursor.x - state.dragOffset.x), Math.round(cursor.y - state.dragOffset.y));
    }, 16);
  });

  ipcMain.on('move-pet-absolute', (event, { mouseX, mouseY }) => {
    if (state.petWindow && state.isDragging) {
      state.petWindow.setPosition(Math.round(mouseX - state.dragOffset.x), Math.round(mouseY - state.dragOffset.y));
    }
  });

  ipcMain.on('set-pet-window-position', (event, x, y) => {
    if (state.petWindow && !state.petWindow.isDestroyed()) state.petWindow.setPosition(x, y);
  });

  ipcMain.on('drag-end', () => {
    state.isDragging = false;
    if (state.dragInterval) { clearInterval(state.dragInterval); state.dragInterval = null; }
    if (state.petWindow && !state.petWindow.isDestroyed()) {
      state.petWindow.setIgnoreMouseEvents(false);
      state.petWindow.setMovable(true);
      state.petWindow.setFocusable(true);
    }
  });

  ipcMain.on('manual-reset-pet-state', () => resetPetState());
  ipcMain.on('query-pet-state', (event) => {
    event.reply('pet-state-info', {
      currentEmotion: state.currentPetEmotion,
      hasTimer: state.petStateTimer !== null,
      timeRemaining: state.petStateTimer ? state.PET_STATE_DURATION : 0
    });
  });

  // === 右键菜单 & 透明度 ===
  ipcMain.on('context-menu-closed', () => { state.contextMenuWindow = null; });

  ipcMain.on('set-pet-transparency', (event, transparency) => {
    state.currentPetTransparency = transparency;
    if (state.petWindow && !state.petWindow.isDestroyed()) {
      state.petWindow.webContents.executeJavaScript(
        `document.documentElement.style.opacity = ${transparency / 100};`
      );
    }
  });

  ipcMain.handle('get-pet-transparency', () => state.currentPetTransparency);

  ipcMain.on('open-transparency-window', () => {
    try {
      if (state.transparencyWindow && !state.transparencyWindow.isDestroyed()) {
        state.transparencyWindow.close(); state.transparencyWindow = null;
      }

      let x = 0, y = 0;
      if (state.contextMenuWindow && !state.contextMenuWindow.isDestroyed()) {
        const bounds = state.contextMenuWindow.getBounds();
        x = bounds.x + bounds.width + 10; y = bounds.y;
      }

      const { BrowserWindow } = require('electron');
      const win = new BrowserWindow({
        width: 160, height: 120,
        frame: false, alwaysOnTop: true, transparent: true,
        resizable: false, skipTaskbar: true, movable: false, focusable: true,
        x, y,
        parent: state.contextMenuWindow, modal: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
      });

      win.loadFile(wm.rendererPath('transparencyWindow.html'));
      win.webContents.once('dom-ready', () => {
        win.webContents.send('current-pet-transparency', state.currentPetTransparency);
      });
      win.on('closed', () => { state.transparencyWindow = null; });
      state.transparencyWindow = win;
    } catch (err) { handleError(err, '透明度窗口'); }
  });

  ipcMain.on('close-transparency-window', () => {
    if (state.transparencyWindow && !state.transparencyWindow.isDestroyed()) {
      state.transparencyWindow.close(); state.transparencyWindow = null;
    }
  });

  ipcMain.on('transparency-window-closed', () => {
    state.transparencyWindow = null;
    if (state.contextMenuWindow && !state.contextMenuWindow.isDestroyed()) {
      setTimeout(() => {
        if (state.contextMenuWindow && !state.contextMenuWindow.isDestroyed()) {
          state.contextMenuWindow.close();
        }
      }, 1000);
    }
  });

  ipcMain.on('transparency-window-opened', () => {
    if (state.contextMenuWindow && !state.contextMenuWindow.isDestroyed()) {
      try {
        state.contextMenuWindow.webContents.send('transparency-window-status', true);
        state.contextMenuWindow.setAlwaysOnTop(true, 'screen-saver');
      } catch (_) { /* ignore */ }
    }
  });

  ipcMain.on('transparency-window-status', (event, isOpen) => {
    if (state.contextMenuWindow && !state.contextMenuWindow.isDestroyed()) {
      try { state.contextMenuWindow.webContents.send('transparency-window-status', isOpen); } catch (_) { /* ignore */ }
    }
  });

  // === 窗口打开 ===
  ipcMain.on('open-todo-window', () => wm.createTodoWindow());
  ipcMain.on('open-pet-settings', () => wm.createPetSettingsWindow());
  ipcMain.on('pet-settings-updated', (event, settings) => updatePetSettings(settings));
  ipcMain.on('open-chat-window', () => wm.createChatWindow());
  ipcMain.on('close-context-menu', () => {
    if (state.contextMenuWindow && !state.contextMenuWindow.isDestroyed()) state.contextMenuWindow.close();
  });
  ipcMain.on('close-pet-status-window', () => {
    if (state.petStatusWindow && !state.petStatusWindow.isDestroyed()) state.petStatusWindow.close();
  });

  // === 快捷键 ===
  ipcMain.on('update-shortcuts', (event, shortcuts) => {
    sm.updateGlobalShortcuts(shortcuts, actionHandlers);
  });
  ipcMain.on('disable-shortcuts', () => globalShortcut.unregisterAll());
  ipcMain.on('enable-shortcuts', (event, shortcuts) => {
    sm.updateGlobalShortcuts(shortcuts, actionHandlers);
  });

  // === 聊天 ===
  ipcMain.on('chat-send-message', async (event, message) => {
    diary.recordEvent('chat');
    state.chatDisplayMessages.push({ role: 'user', text: message });
    storage.save('chatHistory', state.chatDisplayMessages);

    await processChatReply(message, {
      onReply: (reply) => {
        state.chatDisplayMessages.push({ role: 'pet', text: reply });
        storage.save('chatHistory', state.chatDisplayMessages);
        diary.recordChatLog('chat', message, reply);
        if (state.chatWindow && !state.chatWindow.isDestroyed()) {
          state.chatWindow.webContents.send('chat-reply', reply);
        }
      },
      onError: (err) => {
        const fallback = getFriendlyMessage(err, '聊天') || '喵呜…出了点小问题，再试一次吧～';
        state.chatDisplayMessages.push({ role: 'pet', text: fallback });
        storage.save('chatHistory', state.chatDisplayMessages);
        if (state.chatWindow && !state.chatWindow.isDestroyed()) {
          state.chatWindow.webContents.send('chat-reply', fallback);
        }
      }
    });
  });

  ipcMain.on('clear-chat-history', () => {
    clearChatHistory();
    state.chatDisplayMessages = [];
    storage.save('chatHistory', []);
  });

  // === 快捷聊天 ===
  ipcMain.on('quick-chat-send', async (event, userMessage) => {
    diary.recordEvent('chat');
    if (state.quickChatWindow && !state.quickChatWindow.isDestroyed()) {
      state.quickChatWindow.close();
    }

    const now = Date.now();
    if (now - state.quickChatLastTime > state.QUICK_CHAT_CONTEXT_TTL) {
      state.quickChatHistory = [];
    }
    state.quickChatLastTime = now;
    state.quickChatHistory.push({ role: 'user', content: userMessage });
    if (state.quickChatHistory.length > 10) state.quickChatHistory = state.quickChatHistory.slice(-10);

    await processChatReply(userMessage, {
      onReply: (reply) => {
        state.quickChatHistory.push({ role: 'assistant', content: reply });
        diary.recordChatLog('chat', userMessage, reply);
        wm.createPetStatusWindow(reply);
        if (state.petWindow && !state.petWindow.isDestroyed()) {
          state.petWindow.webContents.send('change-emotion', '嘿嘿被夸了');
          setTimeout(() => {
            if (state.petWindow && !state.petWindow.isDestroyed()) state.petWindow.webContents.send('reset-emotion');
          }, 4000);
        }
      },
      onError: (err) => {
        wm.createPetStatusWindow(getFriendlyMessage(err, '快捷聊天'));
      }
    });
  });

  ipcMain.on('quick-chat-close', () => {
    if (state.quickChatWindow && !state.quickChatWindow.isDestroyed()) state.quickChatWindow.close();
  });

  // === 截图 ===
  ipcMain.on('screenshot-question-submit', async (event, question) => {
    if (state.screenshotQuestionWindow && !state.screenshotQuestionWindow.isDestroyed()) {
      state.screenshotQuestionWindow.close();
    }
    if (!state.pendingScreenshotBase64) return;

    diary.recordEvent('screenshot');
    const base64 = state.pendingScreenshotBase64;
    state.pendingScreenshotBase64 = null;

    try {
      const result = await analyzeScreenshot(base64, question || '');
      const aiResponse = typeof result === 'string' ? JSON.parse(result) : result;
      handleAIResponse(aiResponse);
      const screenshotReply = aiResponse?.message || aiResponse?.text || '';
      if (screenshotReply) diary.recordChatLog('screenshot', question || '截图提问', screenshotReply);
    } catch (err) {
      handleError(err, '截图分析', wm.createPetStatusWindow);
      resetPetState();
    }
  });

  ipcMain.on('bubble-clicked', () => {
    if (state.screenshots) state.screenshots.startCapture();
  });

  // === 活动监控 & 提醒 ===
  ipcMain.on('user-activity', () => {
    if (state.activityMonitor) state.activityMonitor.updateActivity();
  });

  ipcMain.on('water-confirmed', () => {
    diary.recordEvent('waterReminder');
    if (state.waterReminderWindow && !state.waterReminderWindow.isDestroyed()) {
      state.waterReminderWindow.close();
    }
  });

  ipcMain.on('water-delayed', () => {
    if (state.waterReminderWindow && !state.waterReminderWindow.isDestroyed()) {
      state.waterReminderWindow.close();
    }
  });

  ipcMain.on('manual-water-reminder', () => wm.createWaterReminderWindow());
  ipcMain.on('manual-fun-reminder', async () => {
    const msg = await generateFunReminder();
    wm.createPetStatusWindow(msg);
  });

  // === 存储 ===
  ipcMain.handle('storage-load', (event, name, fallback) => storage.load(name, fallback));
  ipcMain.handle('storage-save', (event, name, data) => storage.save(name, data));

  ipcMain.on('save-settings', (event, settings) => {
    const toSave = { ...settings };
    delete toSave.petName;
    delete toSave.petCharacter;

    const existing = storage.load('settings', {});

    if (toSave.providerConfigs) {
      const merged = existing.providerConfigs || {};
      for (const [pid, pcfg] of Object.entries(toSave.providerConfigs)) {
        merged[pid] = { ...(merged[pid] || {}), ...pcfg };
      }
      existing.providerConfigs = merged;
      delete toSave.providerConfigs;
    }

    storage.save('settings', { ...existing, ...toSave });

    if (settings.activeProvider !== undefined) {
      const all = storage.load('settings', {});
      const activeCfg = (all.providerConfigs || {})[settings.activeProvider] || {};
      config.setModelConfig({
        provider: settings.activeProvider,
        apiKey: activeCfg.apiKey,
        baseUrl: activeCfg.baseUrl,
        textModel: activeCfg.textModel,
        visionModel: activeCfg.visionModel
      });
    }

    if (settings.doNotDisturb !== undefined) state.doNotDisturb = settings.doNotDisturb;
    if (settings.sedentaryMinutes !== undefined) state.sedentaryMinutes = settings.sedentaryMinutes;
    if (settings.waterMinutes !== undefined) state.waterMinutes = settings.waterMinutes;
  });

  ipcMain.handle('load-settings', () => {
    const s = storage.load('settings', {});
    const { petName, petCharacter, ...rest } = s;
    return {
      ...rest,
      isAIConfigured: config.IS_AI_CONFIGURED,
      activeProvider: config.AI_PROVIDER,
      doNotDisturb: state.doNotDisturb,
      sedentaryMinutes: state.sedentaryMinutes,
      waterMinutes: state.waterMinutes
    };
  });

  ipcMain.handle('get-ai-providers', () => config.AI_PROVIDERS);

  ipcMain.handle('toggle-dnd', () => {
    state.doNotDisturb = !state.doNotDisturb;
    const s = storage.load('settings', {});
    s.doNotDisturb = state.doNotDisturb;
    storage.save('settings', s);
    return state.doNotDisturb;
  });

  ipcMain.handle('get-character-config', () => cs.getCharacterForRenderer());
  ipcMain.handle('list-characters', () => {
    const charDir = cs.getCharactersDir();
    let activeId = 'xiaohei';
    try {
      const defRaw = fs.readFileSync(path.join(charDir, 'default.json'), 'utf-8');
      activeId = JSON.parse(defRaw).activeCharacter || 'xiaohei';
    } catch (_) { /* use fallback */ }
    const files = fs.readdirSync(charDir).filter(f => f.endsWith('.json') && f !== 'default.json');
    const characters = files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(charDir, f), 'utf-8');
        const d = JSON.parse(raw);
        return { id: d.id, name: d.name, desc: d.personality?.default || '' };
      } catch (_) { return null; }
    }).filter(Boolean);
    return { characters, activeId };
  });

  ipcMain.handle('switch-character', (event, newCharId) => {
    try {
      const charDir = cs.getCharactersDir();
      const defPath = path.join(charDir, 'default.json');
      fs.writeFileSync(defPath, JSON.stringify({ activeCharacter: newCharId }, null, 2), 'utf-8');
      cs.loadCharacter(newCharId);
      const char = cs.getCharacter();
      updatePetSettings({ petName: char.name, petCharacter: char.personality.default });
      clearChatHistory();
      if (state.petWindow && !state.petWindow.isDestroyed()) {
        state.petWindow.webContents.send('character-switched');
      }
      return { success: true };
    } catch (err) {
      handleError(err, '切换角色');
      return { success: false, error: getFriendlyMessage(err, '切换角色') };
    }
  });

  ipcMain.on('save-todos', (event, todos) => storage.save('todos', todos));
  ipcMain.handle('load-todos', () => storage.load('todos', []));

  ipcMain.on('schedule-todo-reminder', (event, { text, reminderTime }) => {
    scheduleTodoReminder(Date.now().toString(), text, reminderTime);
  });

  ipcMain.on('save-shortcuts', (event, shortcuts) => storage.save('shortcuts', shortcuts));
  ipcMain.handle('load-shortcuts', () => storage.load('shortcuts', null));

  ipcMain.on('save-chat-history', (event, messages) => storage.save('chatHistory', messages));
  ipcMain.handle('load-chat-history', () => storage.load('chatHistory', []));

  ipcMain.on('add-todo-from-ai', (event, content) => addTodoFromAI(content));

  // === 角色创建/编辑 ===
  ipcMain.on('open-character-creator', () => {
    state.pendingEditCharId = null;
    wm.createCharacterCreatorWindow();
  });

  ipcMain.on('open-character-editor', (event, charId) => {
    state.pendingEditCharId = charId;
    wm.createCharacterCreatorWindow();
  });

  ipcMain.handle('get-edit-character-data', () => {
    if (!state.pendingEditCharId) return null;
    try {
      const charDir = cs.getCharactersDir();
      const fp = path.join(charDir, `${state.pendingEditCharId}.json`);
      if (!fs.existsSync(fp)) return null;
      return { charData: JSON.parse(fs.readFileSync(fp, 'utf-8')), assetsBase: cs.getAssetsDir().replace(/\\/g, '/') };
    } catch (err) {
      handleError(err, '加载角色数据');
      return null;
    }
  });

  ipcMain.handle('update-character', (event, charData) => {
    try {
      const fp = path.join(cs.getCharactersDir(), `${charData.id}.json`);
      fs.writeFileSync(fp, JSON.stringify(charData, null, 2), 'utf-8');
      if (state.petSettingsWindow && !state.petSettingsWindow.isDestroyed()) {
        state.petSettingsWindow.webContents.send('refresh-character-list');
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('save-new-character', (event, charData) => {
    try {
      const fp = path.join(cs.getCharactersDir(), `${charData.id}.json`);
      if (fs.existsSync(fp)) return { success: false, error: `角色ID「${charData.id}」已存在` };
      fs.writeFileSync(fp, JSON.stringify(charData, null, 2), 'utf-8');
      if (state.petSettingsWindow && !state.petSettingsWindow.isDestroyed()) {
        state.petSettingsWindow.webContents.send('refresh-character-list');
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-assets-dir', () => cs.getAssetsDir().replace(/\\/g, '/'));

  ipcMain.handle('generate-character-content', async (event, { name, personality }) => {
    try {
      if (!config.IS_AI_CONFIGURED) return { success: false, error: '请先在桌宠设置中配置 API Key' };
      const OpenAI = require('openai');
      const client = new OpenAI({ apiKey: config.DASHSCOPE_API_KEY, baseURL: config.DASHSCOPE_BASE_URL });
      const prompt = `你是一个桌宠角色设计助手。根据以下角色信息，生成角色的英文ID、性格预设和AI回复风格。

角色名称：${name}
角色性格描述：${personality}

请严格按以下JSON格式返回，不要输出其他内容：
{
  "id": "角色的英文标识，全小写字母，简短有意义",
  "presets": {
    "p1": { "label": "2-4字的性格标签", "prompt": "基于角色特点的完整性格变体描述，30-60字" },
    "p2": { "label": "2-4字的性格标签", "prompt": "另一种性格变体描述，30-60字" },
    "p3": { "label": "2-4字的性格标签", "prompt": "另一种性格变体描述，30-60字" },
    "p4": { "label": "2-4字的性格标签", "prompt": "另一种性格变体描述，30-60字" }
  },
  "style": {
    "screenshot": "看到截图时的反应方式描述，15-30字",
    "chat": "日常聊天的语气风格描述，15-30字",
    "reminder": "提醒主人时的语气描述，10-20字",
    "greeting": "打招呼的方式描述，10-20字",
    "thought": "碎碎念的风格描述，10-20字",
    "milestone": "里程碑感言的风格描述，10-20字",
    "poke": "被主人戳一戳时的反应方式描述，10-20字"
  }
}

要求：
1. id 必须是纯英文小写字母和下划线
2. 4个预设应该是同一角色的不同性格侧面
3. 风格描述要体现角色的独特个性
4. 所有内容都要贴合角色的性格设定
5. style中的风格描述只写抽象的风格方向，不要包含具体台词`;

      const resp = await client.chat.completions.create({
        model: config.AI_TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8
      });
      const text = resp.choices[0].message.content.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { success: false, error: 'AI返回格式异常' };
      return { success: true, data: JSON.parse(jsonMatch[0]) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('copy-asset-files', async (event, { targetDir, files }) => {
    try {
      const destDir = path.join(cs.getAssetsDir(), targetDir);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const results = [];
      for (const f of files) {
        fs.copyFileSync(f.sourcePath, path.join(destDir, f.name));
        results.push({ name: f.name, success: true });
      }
      return { success: true, dir: destDir.replace(/\\/g, '/'), results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('select-gif-files', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      title: '选择GIF文件',
      filters: [{ name: 'GIF图片', extensions: ['gif', 'png'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return { canceled: true, files: [] };
    return {
      canceled: false,
      files: result.filePaths.map(fp => ({ path: fp, name: path.basename(fp) }))
    };
  });

  // === 悬浮工具栏 ===
  ipcMain.on('toolbar-quick-chat', () => wm.createQuickChatWindow());

  ipcMain.on('toolbar-screenshot', () => {
    if (state.screenshots) {
      try {
        if (state.petWindow && !state.petWindow.isDestroyed()) {
          state.petWindow.webContents.send('change-emotion', '好复杂');
        }
      } catch (_) { /* ignore */ }
      wm.createPetStatusWindow('思考中…');
      state.screenshots.startCapture();
    } else {
      wm.createPetStatusWindow('截图功能未初始化');
    }
  });

  // === 心情日记 ===
  ipcMain.on('open-diary-window', () => wm.createDiaryWindow());

  ipcMain.handle('diary-get-list', () => diary.getDiaryList());

  ipcMain.handle('diary-generate', async (event, dateKey) => {
    try {
      const dayData = diary.getDayData(dateKey);
      const stats = dayData ? dayData.stats : { pokeCount: 0, chatCount: 0, screenshotCount: 0, todosAdded: 0, todosCompleted: 0, waterReminders: 0, emotionChanges: [] };
      const text = await generateDiary(dateKey, stats);
      diary.saveDiaryEntry(dateKey, text);
      return { success: true };
    } catch (err) {
      handleError(err, '生成日记');
      return { success: false, error: getFriendlyMessage(err, '生成日记') };
    }
  });

  ipcMain.on('diary-record-event', (event, eventType, data) => {
    diary.recordEvent(eventType, data);
  });

  // === 开机自启 ===
  ipcMain.handle('get-auto-launch', () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.on('set-auto-launch', (event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    console.log('Auto launch set to:', enabled);
  });

  // === 保存/恢复宠物窗口位置 ===
  ipcMain.on('save-pet-position', () => {
    if (state.petWindow && !state.petWindow.isDestroyed()) {
      const [x, y] = state.petWindow.getPosition();
      storage.save('petPosition', { x, y });
    }
  });

  // === 表情气泡 ===
  ipcMain.on('emoji-bubble-tick', () => {
    if (state.petWindow && !state.petWindow.isDestroyed() && !state.doNotDisturb) {
      state.petWindow.webContents.send('show-emoji-bubble');
    }
  });

  return actionHandlers;
}

function handleAIResponse(aiResponse) {
  if (!aiResponse) return;
  const message = aiResponse.message || aiResponse.text || '';
  const emotion = aiResponse.emotion || '';

  if (message) wm.createPetStatusWindow(message);

  if (emotion && state.petWindow && !state.petWindow.isDestroyed()) {
    diary.recordEvent('emotion', { emotion });
    state.petWindow.webContents.send('change-emotion', emotion);
    setPetState(emotion);
  } else {
    resetPetState();
  }
}

module.exports = {
  registerAll,
  restoreTodoReminders,
  startTodoReminder,
  stopTodoReminder,
  resetPetState,
  triggerPoke,
  buildActionHandlers
};
