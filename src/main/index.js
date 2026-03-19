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
  const globalSettings = storage.load('settings', null);
  if (globalSettings) {
    if (globalSettings.apiKey) config.setApiKey(globalSettings.apiKey);
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

  setTimeout(() => {
    wm.createMainWindow();
    wm.createPetWindow();
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
  globalShortcut.unregisterAll();
  if (state.activityMonitor) state.activityMonitor.destroy();
  proactiveEngine.destroy();
  ipc.stopTodoReminder();
});
