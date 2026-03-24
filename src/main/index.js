/**
 * AI-DeskPet 入口 — 应用生命周期和初始化
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { app, globalShortcut, Menu } = require('electron');
const Screenshots = require('electron-screenshots');
const { ActivityMonitor, setCreatePetStatusWindowFunction, setCreateWaterReminderWindowFunction } = require('./activityMonitor');
const { updatePetSettings, clearChatHistory } = require('./aiService');
const proactiveEngine = require('./proactiveEngine');
const storage = require('./storageService');
const config = require('./config');
const cs = require('./characterService');
const state = require('./appState');
const wm = require('./windowManager');
const sm = require('./shortcutManager');
const ipc = require('./ipcHandlers');
const { handleError } = require('./errorHandler');

const EMOJI_BUBBLE_MIN = 3 * 60 * 1000;
const EMOJI_BUBBLE_MAX = 8 * 60 * 1000;

function startEmojiBubbleTimer() {
  function scheduleNext() {
    const delay = EMOJI_BUBBLE_MIN + Math.random() * (EMOJI_BUBBLE_MAX - EMOJI_BUBBLE_MIN);
    state.emojiBubbleTimer = setTimeout(() => {
      if (!state.doNotDisturb && state.petWindow && !state.petWindow.isDestroyed()) {
        state.petWindow.webContents.send('show-emoji-bubble');
      }
      scheduleNext();
    }, delay);
  }
  scheduleNext();
}

app.disableHardwareAcceleration();
app.setAppUserModelId('com.ai-deskpet.app');
Menu.setApplicationMenu(null);
app.setPath('userData', path.join(app.getPath('appData'), 'ai_deskPet'));

function setupScreenshots() {
  try {
    state.screenshots = new Screenshots({ singleWindow: false });

    state.screenshots.on('ok', async (e, buffer, bounds) => {
      try {
        state.pendingScreenshotBase64 = Buffer.from(buffer).toString('base64');
        wm.createScreenshotQuestionWindow();
      } catch (err) {
        handleError(err, '截图分析', wm.createPetStatusWindow);
      }
    });

    state.screenshots.on('cancel', () => {
      ipc.resetPetState();
    });

    state.screenshots.on('error', (e, err) => {
      handleError(err, '截图模块');
    });

    console.log('Screenshots module initialized');
  } catch (err) {
    handleError(err, '截图模块初始化', wm.createPetStatusWindow);
  }
}

function checkAndShowPetSettingsOnStartup() {
  const char = cs.getCharacter();
  const defaults = { petName: char.name, petCharacter: char.personality.default };
  updatePetSettings(defaults);
  config.loadModelConfig();
  const globalSettings = storage.load('settings', null);
  if (globalSettings) {
    if (globalSettings.doNotDisturb !== undefined) state.doNotDisturb = globalSettings.doNotDisturb;
    if (globalSettings.sedentaryMinutes !== undefined) state.sedentaryMinutes = globalSettings.sedentaryMinutes;
    if (globalSettings.waterMinutes !== undefined) state.waterMinutes = globalSettings.waterMinutes;
  }
}

app.whenReady().then(() => {
  const defaultConf = JSON.parse(fs.readFileSync(
    path.join(cs.getCharactersDir(), 'default.json'), 'utf-8'
  ));
  cs.loadCharacter(defaultConf.activeCharacter);
  config.loadApiKeyFromStorage();
  state.chatDisplayMessages = storage.load('chatHistory', []);

  const diary = require('./diaryService');
  diary.ensureToday();

  setTimeout(() => {
    wm.createMainWindow();
    wm.createPetWindow();

    const savedPos = storage.load('petPosition', null);
    if (savedPos && state.petWindow && !state.petWindow.isDestroyed()) {
      const { screen } = require('electron');
      const displays = screen.getAllDisplays();
      const inBounds = displays.some(d => {
        const wa = d.workArea;
        return savedPos.x >= wa.x && savedPos.x < wa.x + wa.width &&
               savedPos.y >= wa.y && savedPos.y < wa.y + wa.height;
      });
      if (inBounds) {
        state.petWindow.setPosition(savedPos.x, savedPos.y);
      }
    }

    setupScreenshots();

    const actionHandlers = ipc.registerAll();
    sm.loadAndRegisterShortcuts(actionHandlers);
    ipc.restoreTodoReminders();

    setCreatePetStatusWindowFunction(wm.createPetStatusWindow);
    setCreateWaterReminderWindowFunction(wm.createWaterReminderWindow);
    state.activityMonitor = new ActivityMonitor();

    ipc.startTodoReminder();

    proactiveEngine.init({
      showMessage: (msg) => wm.createPetStatusWindow(msg),
      changeEmotion: (emotion) => {
        if (state.petWindow && !state.petWindow.isDestroyed()) {
          if (emotion) {
            state.petWindow.webContents.send('change-emotion', emotion);
          } else {
            state.petWindow.webContents.send('reset-emotion');
          }
        }
      }
    });

    checkAndShowPetSettingsOnStartup();

    startEmojiBubbleTimer();
  }, 1000);
}).catch(err => {
  handleError(err, '应用初始化');
});

app.on('activate', () => {
  const { BrowserWindow } = require('electron');
  if (BrowserWindow.getAllWindows().length === 0) {
    wm.createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (state.petWindow && !state.petWindow.isDestroyed()) {
    const [x, y] = state.petWindow.getPosition();
    storage.save('petPosition', { x, y });
  }
  globalShortcut.unregisterAll();
  if (state.activityMonitor) state.activityMonitor.destroy();
  proactiveEngine.destroy();
  ipc.stopTodoReminder();
  if (state.emojiBubbleTimer) {
    clearTimeout(state.emojiBubbleTimer);
    state.emojiBubbleTimer = null;
  }
});
