/**
 * 窗口管理 — 所有 BrowserWindow 的创建和定位逻辑
 */
const path = require('path');
const { BrowserWindow } = require('electron');
const state = require('./appState');
const { getCurrentPetSettings } = require('./aiService');
const { handleError } = require('./errorHandler');

function rendererPath(name) {
  return path.join(__dirname, '../renderer', name);
}

function getPetDisplay() {
  const { screen } = require('electron');
  if (state.petWindow && !state.petWindow.isDestroyed()) {
    const [px, py] = state.petWindow.getPosition();
    const [pw, ph] = state.petWindow.getSize();
    return screen.getDisplayNearestPoint({ x: px + pw / 2, y: py + ph / 2 });
  }
  return screen.getPrimaryDisplay();
}

function createMainWindow() {
  state.mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true
  });

  state.mainWindow.loadFile(rendererPath('index.html'));

  state.mainWindow.on('close', (event) => {
    const { app } = require('electron');
    if (!app.isQuitting) {
      event.preventDefault();
      state.mainWindow.hide();
    }
  });

  state.mainWindow.webContents.on('dom-ready', () => {
    state.mainWindow.webContents.executeJavaScript(`
      document.addEventListener('mousemove', () => {
        require('electron').ipcRenderer.send('user-activity');
      });
      document.addEventListener('keydown', () => {
        require('electron').ipcRenderer.send('user-activity');
      });
    `);
  });
}

function createPetWindow() {
  state.petWindow = new BrowserWindow({
    width: 100,
    height: 100,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    movable: true,
    focusable: true,
    type: 'toolbar'
  });

  state.petWindow.loadFile(rendererPath('pet.html'));

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  state.petWindow.setPosition(width - 120, height - 120);
  state.petWindow.setIgnoreMouseEvents(false);
  state.petWindow.setMovable(true);
  state.petWindow.setAlwaysOnTop(true, 'screen-saver');

  state.petWindow.on('blur', () => {
    if (!state.petWindow.isDestroyed()) {
      state.petWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  state.petWindow.on('show', () => {
    if (!state.petWindow.isDestroyed()) {
      state.petWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  const ensureTopMost = setInterval(() => {
    if (state.petWindow && !state.petWindow.isDestroyed() && state.petWindow.isVisible()) {
      state.petWindow.setAlwaysOnTop(true, 'screen-saver');
    } else {
      clearInterval(ensureTopMost);
    }
  }, 5000);

  state.petWindow.webContents.on('dom-ready', () => {
    state.petWindow.webContents.executeJavaScript(`
      try {
        const pet = document.getElementById('pet');
        if (pet) {
          pet.addEventListener('click', () => {
            require('electron').ipcRenderer.send('pet-clicked');
          });
        }
      } catch (error) {
        handleError(error, '桌宠点击监听');
      }
    `).catch(err => handleError(err, '桌宠窗口脚本'));
  });

  return state.petWindow;
}

function createPetStatusWindow(message) {
  if (state.petStatusWindow && !state.petStatusWindow.isDestroyed()) {
    try {
      state.petStatusWindow.close();
    } catch (_) { /* ignore */ }
    state.petStatusWindow = null;
  }

  const win = new BrowserWindow({
    width: 248, height: 148,
    frame: false, alwaysOnTop: true, transparent: true,
    resizable: false, skipTaskbar: true, movable: false,
    focusable: true, hasShadow: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  win.loadFile(rendererPath('petStatus.html'));

  const display = getPetDisplay();
  const wa = display.workArea;
  const sLeft = wa.x, sTop = wa.y;
  const sRight = wa.x + wa.width, sBottom = wa.y + wa.height;

  let petPosition, petSize;
  if (state.petWindow && !state.petWindow.isDestroyed()) {
    try {
      petPosition = state.petWindow.getPosition();
      petSize = state.petWindow.getSize();
      if (!Array.isArray(petPosition) || !Array.isArray(petSize)) throw new Error();
    } catch (_) {
      petPosition = [sRight - 120, sBottom - 120];
      petSize = [100, 100];
    }
  } else {
    petPosition = [sRight - 120, sBottom - 120];
    petSize = [100, 100];
  }

  const bw = 248, bh = 148, gap = 2;
  const leftSpace = petPosition[0] - sLeft;
  const rightSpace = sRight - (petPosition[0] + petSize[0]);

  let bx, by, dir;

  if (rightSpace >= leftSpace && rightSpace >= bw + gap + 10) {
    bx = petPosition[0] + petSize[0] + gap;
    by = petPosition[1] + petSize[1] / 2 - bh + 24;
    dir = 'right';
  } else if (leftSpace >= bw + gap + 10) {
    bx = petPosition[0] - bw - gap;
    by = petPosition[1] + petSize[1] / 2 - bh + 24;
    dir = 'left';
  } else if (petPosition[1] - bh - gap >= sTop + 10) {
    bx = rightSpace >= leftSpace
      ? petPosition[0] + petSize[0] * 0.3
      : petPosition[0] + petSize[0] * 0.7 - bw;
    by = petPosition[1] - bh - gap;
    dir = 'top';
  } else {
    bx = rightSpace >= leftSpace
      ? petPosition[0] + petSize[0] * 0.3
      : petPosition[0] + petSize[0] * 0.7 - bw;
    by = petPosition[1] + petSize[1] + gap;
    dir = 'bottom';
  }

  bx = Math.max(sLeft + 5, Math.min(sRight - bw - 5, bx));
  by = Math.max(sTop + 5, Math.min(sBottom - bh - 5, by));
  win.setPosition(Math.round(bx), Math.round(by));

  win.webContents.once('dom-ready', () => {
    try {
      win.webContents.send('update-status-message', message);
      win.webContents.send('set-bubble-direction', dir);
    } catch (_) { /* ignore */ }
  });

  win.webContents.on('crashed', () => { state.petStatusWindow = null; });
  win.webContents.on('did-fail-load', () => { state.petStatusWindow = null; });
  win.on('closed', () => { state.petStatusWindow = null; });
  win.on('blur', () => {
    if (win && !win.isDestroyed()) win.close();
  });

  state.petStatusWindow = win;
  return win;
}

function createPersistentReminder(message) {
  const win = new BrowserWindow({
    width: 308, height: 168,
    frame: false, alwaysOnTop: true, transparent: true,
    resizable: false, skipTaskbar: true, focusable: true, hasShadow: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  win.loadFile(rendererPath('petStatus.html'));

  const display = getPetDisplay();
  const wa = display.workArea;
  let rx, ry, dir = 'top';

  if (state.petWindow && !state.petWindow.isDestroyed()) {
    const [px, py] = state.petWindow.getPosition();
    const [pw, ph] = state.petWindow.getSize();
    const leftSpace = px - wa.x;
    const rightSpace = (wa.x + wa.width) - (px + pw);
    const gap = 4;

    if (rightSpace >= leftSpace && rightSpace >= 290) {
      rx = px + pw + gap; ry = py + ph / 2 - 100; dir = 'right';
    } else if (leftSpace >= 290) {
      rx = px - 280 - gap; ry = py + ph / 2 - 100; dir = 'left';
    } else {
      rx = rightSpace >= leftSpace ? px + pw * 0.3 : px + pw * 0.7 - 280;
      ry = py - 150;
      if (ry < wa.y + 10) { ry = py + ph + gap; dir = 'bottom'; }
    }
  } else {
    rx = wa.x + wa.width / 2 - 140;
    ry = wa.y + wa.height / 3;
  }

  rx = Math.max(wa.x + 5, Math.min(wa.x + wa.width - 290, rx));
  ry = Math.max(wa.y + 5, Math.min(wa.y + wa.height - 150, ry));
  win.setPosition(Math.round(rx), Math.round(ry));

  win.webContents.once('dom-ready', () => {
    win.webContents.send('update-status-message', message);
    win.webContents.send('set-bubble-direction', dir);
    win.webContents.send('set-persistent-mode', 15000);
  });

  win.on('closed', () => { console.log('Persistent reminder closed'); });
}

function createChatWindow() {
  if (state.chatWindow && !state.chatWindow.isDestroyed()) {
    state.chatWindow.show();
    state.chatWindow.focus();
    return state.chatWindow;
  }

  const display = getPetDisplay();
  const wa = display.workArea;
  let winX = wa.x + wa.width - 380;
  let winY = wa.y + wa.height - 560;

  if (state.petWindow && !state.petWindow.isDestroyed()) {
    const [petX, petY] = state.petWindow.getPosition();
    winX = petX - 330;
    winY = petY - 420;
    if (winX < wa.x + 10) winX = petX + 110;
    if (winY < wa.y + 10) winY = wa.y + 10;
    if (winX + 320 > wa.x + wa.width) winX = wa.x + wa.width - 330;
    if (winY + 500 > wa.y + wa.height) winY = wa.y + wa.height - 510;
  }

  state.chatWindow = new BrowserWindow({
    width: 320, height: 500, x: winX, y: winY,
    frame: false, transparent: false, resizable: true,
    minimizable: true, maximizable: false,
    alwaysOnTop: true, skipTaskbar: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  state.chatWindow.loadFile(rendererPath('chatWindow.html'));

  state.chatWindow.webContents.once('dom-ready', () => {
    const petSettings = getCurrentPetSettings();
    state.chatWindow.webContents.send('set-pet-name', petSettings.petName);
    if (state.chatDisplayMessages.length > 0) {
      state.chatWindow.webContents.send('chat-restore-history', state.chatDisplayMessages);
    }
  });

  state.chatWindow.on('closed', () => { state.chatWindow = null; });
  return state.chatWindow;
}

function createQuickChatWindow() {
  if (state.quickChatWindow && !state.quickChatWindow.isDestroyed()) {
    state.quickChatWindow.show();
    state.quickChatWindow.focus();
    return;
  }

  const winW = 280, winH = 50;
  const display = getPetDisplay();
  const wa = display.workArea;
  const sLeft = wa.x, sTop = wa.y;
  const sRight = wa.x + wa.width, sBottom = wa.y + wa.height;

  let winX, winY;

  if (state.petWindow && !state.petWindow.isDestroyed()) {
    const [petX, petY] = state.petWindow.getPosition();
    const [petW, petH] = state.petWindow.getSize();
    winX = petX + petW / 2 - winW / 2;
    winY = (petY - winH - 20 >= sTop + 10) ? petY - winH - 20 : petY + petH + 20;
    winX = Math.max(sLeft + 5, Math.min(sRight - winW - 5, winX));
    winY = Math.max(sTop + 5, Math.min(sBottom - winH - 5, winY));
  } else {
    winX = Math.round(sLeft + (wa.width - winW) / 2);
    winY = Math.round(sTop + wa.height * 0.35);
  }

  state.quickChatWindow = new BrowserWindow({
    width: winW, height: winH,
    x: Math.round(winX), y: Math.round(winY),
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  state.quickChatWindow.loadFile(rendererPath('quickChat.html'));

  state.quickChatWindow.on('blur', () => {
    if (state.quickChatWindow && !state.quickChatWindow.isDestroyed()) {
      state.quickChatWindow.close();
    }
  });
  state.quickChatWindow.on('closed', () => { state.quickChatWindow = null; });
}

function createContextMenuWindow(x, y) {
  if (state.contextMenuWindow && !state.contextMenuWindow.isDestroyed()) {
    try { state.contextMenuWindow.close(); } catch (_) { /* ignore */ }
    state.contextMenuWindow = null;
  }

  const win = new BrowserWindow({
    width: 180, height: 220,
    frame: false, alwaysOnTop: true, transparent: true,
    resizable: false, skipTaskbar: true, movable: false, focusable: true,
    parent: state.petWindow, modal: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  win.loadFile(rendererPath('contextMenu.html'));

  const display = getPetDisplay();
  const wa = display.workArea;
  const menuW = 180, menuH = 220;
  let fx = x, fy = y;

  if (fx + menuW > wa.x + wa.width) fx = wa.x + wa.width - menuW - 10;
  if (fx < wa.x + 10) fx = wa.x + 10;

  const above = y - wa.y;
  if (above >= menuH + 20) {
    fy = y - menuH - 10;
  } else if ((wa.y + wa.height) - y - menuH >= menuH + 20) {
    fy = y + 20;
  } else {
    if (y + menuH > wa.y + wa.height) fy = wa.y + wa.height - menuH - 10;
    if (fy < wa.y + 10) fy = wa.y + 10;
  }

  win.setPosition(fx, fy);
  win.on('closed', () => { state.contextMenuWindow = null; });
  state.contextMenuWindow = win;
  return win;
}

function createBubbleWindow(message) {
  state.bubbleWindow = new BrowserWindow({
    width: 300, height: 100,
    frame: false, alwaysOnTop: true, transparent: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  state.bubbleWindow.loadFile(rendererPath('bubble.html'));
  state.bubbleWindow.webContents.once('dom-ready', () => {
    state.bubbleWindow.webContents.send('update-bubble-message', message);
  });
  return state.bubbleWindow;
}

function createWaterReminderWindow() {
  try {
    if (state.waterReminderWindow && !state.waterReminderWindow.isDestroyed()) {
      state.waterReminderWindow.show();
      state.waterReminderWindow.focus();
      return state.waterReminderWindow;
    }

    state.waterReminderWindow = new BrowserWindow({
      width: 640, height: 520,
      frame: false, alwaysOnTop: true, transparent: true,
      resizable: false, skipTaskbar: true,
      movable: true, focusable: true,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    state.waterReminderWindow.loadFile(rendererPath('waterReminder.html'));

    const d = getPetDisplay();
    const wa = d.workArea;
    state.waterReminderWindow.setPosition(
      Math.round(wa.x + (wa.width - 640) / 2),
      Math.round(wa.y + (wa.height - 520) / 2)
    );

    state.waterReminderWindow.on('closed', () => { state.waterReminderWindow = null; });
    return state.waterReminderWindow;
  } catch (error) {
    handleError(error, '喝水提醒窗口');
    createPetStatusWindow('💧 该喝水啦！记得保持水分补充哦～');
  }
}

function createTodoWindow() {
  try {
    if (state.todoWindow && !state.todoWindow.isDestroyed()) {
      state.todoWindow.show();
      state.todoWindow.focus();
      return state.todoWindow;
    }

    state.todoWindow = new BrowserWindow({
      width: 800, height: 700,
      frame: false, alwaysOnTop: false, resizable: true,
      skipTaskbar: false, movable: true, focusable: true, show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    state.todoWindow.loadFile(rendererPath('todoWindow.html'));

    const d = getPetDisplay();
    const wa = d.workArea;
    state.todoWindow.setPosition(
      Math.round(wa.x + (wa.width - 800) / 2),
      Math.round(wa.y + (wa.height - 700) / 2)
    );

    state.todoWindow.once('ready-to-show', () => { state.todoWindow.show(); });
    state.todoWindow.on('closed', () => { state.todoWindow = null; });
    return state.todoWindow;
  } catch (error) {
    handleError(error, '待办窗口');
  }
}

function createPetSettingsWindow() {
  try {
    if (state.petSettingsWindow && !state.petSettingsWindow.isDestroyed()) {
      state.petSettingsWindow.show();
      state.petSettingsWindow.focus();
      return state.petSettingsWindow;
    }

    state.petSettingsWindow = new BrowserWindow({
      width: 520, height: 780,
      frame: false, alwaysOnTop: false, resizable: true,
      skipTaskbar: false, movable: true, focusable: true, show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    state.petSettingsWindow.loadFile(rendererPath('petSettings.html'));

    const d = getPetDisplay();
    const wa = d.workArea;
    state.petSettingsWindow.setPosition(
      Math.round(wa.x + (wa.width - 520) / 2),
      Math.round(wa.y + (wa.height - 780) / 2)
    );

    state.petSettingsWindow.once('ready-to-show', () => { state.petSettingsWindow.show(); });
    state.petSettingsWindow.on('closed', () => { state.petSettingsWindow = null; });
    return state.petSettingsWindow;
  } catch (error) {
    handleError(error, '桌宠设置窗口');
  }
}


function createScreenshotQuestionWindow() {
  if (state.screenshotQuestionWindow && !state.screenshotQuestionWindow.isDestroyed()) {
    state.screenshotQuestionWindow.show();
    state.screenshotQuestionWindow.focus();
    return;
  }

  const display = getPetDisplay();
  const wa = display.workArea;
  let winX, winY;
  const winW = 340, winH = 60;

  if (state.petWindow && !state.petWindow.isDestroyed()) {
    const [px, py] = state.petWindow.getPosition();
    const [pw] = state.petWindow.getSize();
    winX = px + pw / 2 - winW / 2;
    winY = py - winH - 30;
    if (winY < wa.y + 10) winY = py + 120;
    winX = Math.max(wa.x + 5, Math.min(wa.x + wa.width - winW - 5, winX));
    winY = Math.max(wa.y + 5, Math.min(wa.y + wa.height - winH - 5, winY));
  } else {
    winX = Math.round(wa.x + (wa.width - winW) / 2);
    winY = Math.round(wa.y + wa.height * 0.35);
  }

  state.screenshotQuestionWindow = new BrowserWindow({
    width: winW, height: winH,
    x: Math.round(winX), y: Math.round(winY),
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  state.screenshotQuestionWindow.loadFile(rendererPath('screenshotQuestion.html'));

  state.screenshotQuestionWindow.on('blur', () => {
    if (state.screenshotQuestionWindow && !state.screenshotQuestionWindow.isDestroyed()) {
      state.screenshotQuestionWindow.webContents.send('auto-submit');
    }
  });
  state.screenshotQuestionWindow.on('closed', () => { state.screenshotQuestionWindow = null; });
}

function createCharacterCreatorWindow() {
  try {
    if (state.characterCreatorWindow && !state.characterCreatorWindow.isDestroyed()) {
      state.characterCreatorWindow.show();
      state.characterCreatorWindow.focus();
      return;
    }

    state.characterCreatorWindow = new BrowserWindow({
      width: 640, height: 780,
      frame: false, resizable: true, skipTaskbar: false,
      movable: true, focusable: true, show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    state.characterCreatorWindow.loadFile(rendererPath('characterCreator.html'));

    const d = getPetDisplay();
    const wa = d.workArea;
    state.characterCreatorWindow.setPosition(
      Math.round(wa.x + (wa.width - 640) / 2),
      Math.round(wa.y + (wa.height - 780) / 2)
    );

    state.characterCreatorWindow.once('ready-to-show', () => { state.characterCreatorWindow.show(); });
    state.characterCreatorWindow.on('closed', () => { state.characterCreatorWindow = null; });
  } catch (error) {
    handleError(error, '角色编辑器窗口');
  }
}

function showScreenshotBubble(message) {
  const bw = createBubbleWindow(message);
  const d = getPetDisplay();
  const wa = d.workArea;
  bw.setPosition(wa.x + wa.width - 310, wa.y + 150);
  setTimeout(() => {
    if (bw && !bw.isDestroyed()) bw.close();
  }, 10000);
}

function togglePetWindow() {
  if (state.petWindow && !state.petWindow.isDestroyed()) {
    if (state.petWindow.isVisible()) {
      state.petWindow.hide();
    } else {
      state.petWindow.show();
      state.petWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }
}

module.exports = {
  rendererPath,
  getPetDisplay,
  createMainWindow,
  createPetWindow,
  createPetStatusWindow,
  createPersistentReminder,
  createChatWindow,
  createQuickChatWindow,
  createContextMenuWindow,
  createBubbleWindow,
  createWaterReminderWindow,
  createTodoWindow,
  createPetSettingsWindow,
  createScreenshotQuestionWindow,
  createCharacterCreatorWindow,
  showScreenshotBubble,
  togglePetWindow
};
