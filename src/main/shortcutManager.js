/**
 * 快捷键管理 — 注册、更新、处理快捷键动作
 */
const { globalShortcut } = require('electron');
const storage = require('./storageService');
const state = require('./appState');
const { handleError } = require('./errorHandler');

const defaultShortcuts = {
  'quick-chat': { key: 'Alt+F1', description: '快捷聊天' },
  'ai-screenshot': { key: 'Alt+F2', description: 'AI区域截图' },
  'water-reminder': { key: '', description: '喝水提醒' },
  'poke-pet': { key: 'Alt+F3', description: '戳一戳小黑' },
  'open-chat': { key: '', description: '打开聊天' },
  'toggle-pet': { key: 'Ctrl+H', description: '桌宠隐藏/显示' },
  'open-todo': { key: 'Ctrl+T', description: '打开待办' },
  'open-main': { key: 'Ctrl+O', description: '打开主页面' }
};

function normalizeAccelerator(key) {
  if (!key) return '';
  return key
    .replace(/\bctrl\b/gi, 'Ctrl')
    .replace(/\bshift\b/gi, 'Shift')
    .replace(/\balt\b/gi, 'Alt')
    .replace(/\bcmd\b/gi, 'Cmd')
    .replace(/\bcommand\b/gi, 'Cmd')
    .replace(/\bmeta\b/gi, 'Cmd')
    .replace(/\bcontrol\b/gi, 'Ctrl')
    .replace(/\boption\b/gi, 'Alt');
}

/**
 * @param {Object} actionHandlers  { actionName: asyncFunction }
 */
function loadAndRegisterShortcuts(actionHandlers) {
  try {
    let shortcuts = { ...defaultShortcuts };
    const saved = storage.load('shortcuts', null);
    if (saved) Object.assign(shortcuts, saved);

    Object.entries(shortcuts).forEach(([action, config]) => {
      try {
        if (!config.key) return;
        const acc = normalizeAccelerator(config.key);
        const ok = globalShortcut.register(acc, async () => {
          if (actionHandlers[action]) await actionHandlers[action]();
        });
        if (!ok) handleError(new Error(`快捷键 ${acc} 注册失败`), `快捷键 ${action}`);
      } catch (err) {
        handleError(err, `快捷键 ${action}`);
      }
    });
  } catch (err) {
    handleError(err, '加载快捷键');
  }
}

function updateGlobalShortcuts(shortcuts, actionHandlers) {
  try {
    globalShortcut.unregisterAll();
    Object.entries(shortcuts).forEach(([action, config]) => {
      try {
        if (!config.key) return;
        const acc = normalizeAccelerator(config.key);
        const ok = globalShortcut.register(acc, async () => {
          if (actionHandlers[action]) await actionHandlers[action]();
        });
        if (!ok) handleError(new Error(`快捷键 ${acc} 注册失败`), `快捷键 ${action}`);
      } catch (err) {
        handleError(err, `快捷键 ${action}`);
      }
    });
  } catch (err) {
    handleError(err, '更新快捷键');
  }
}

module.exports = {
  defaultShortcuts,
  normalizeAccelerator,
  loadAndRegisterShortcuts,
  updateGlobalShortcuts
};
