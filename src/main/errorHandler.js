/**
 * 统一异常处理 — 分类错误并提供友好提示
 */
const { dialog, BrowserWindow } = require('electron');

const ERROR_MESSAGES = {
  NETWORK: '网络连接失败，请检查网络后重试',
  AI_API: 'AI 服务暂时不可用，请稍后重试',
  API_KEY: '未配置 API Key，请在设置中填写',
  FILE_READ: '读取文件失败，请检查文件是否存在',
  FILE_WRITE: '保存文件失败，请检查磁盘空间和权限',
  WINDOW: '窗口创建失败，请重启应用',
  SHORTCUT: '快捷键注册失败，可能与其他程序冲突',
  CHARACTER: '角色数据加载失败，请检查角色配置',
  SCREENSHOT: '截图功能异常，请重启应用',
  UNKNOWN: '发生了意外错误，请重启应用'
};

function classifyError(error) {
  const msg = (error?.message || error?.toString() || '').toLowerCase();

  if (msg.includes('enotfound') || msg.includes('econnrefused') ||
      msg.includes('etimedout') || msg.includes('fetch failed') ||
      msg.includes('network') || msg.includes('socket hang up')) {
    return 'NETWORK';
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('api key') ||
      msg.includes('unauthorized') || msg.includes('authentication')) {
    return 'API_KEY';
  }
  if (msg.includes('429') || msg.includes('500') || msg.includes('502') ||
      msg.includes('503') || msg.includes('rate limit') || msg.includes('quota')) {
    return 'AI_API';
  }
  if (msg.includes('enoent') || msg.includes('no such file')) {
    return 'FILE_READ';
  }
  if (msg.includes('eacces') || msg.includes('eperm') || msg.includes('enospc')) {
    return 'FILE_WRITE';
  }
  if (msg.includes('browserwindow') || msg.includes('window') && msg.includes('destroyed')) {
    return 'WINDOW';
  }
  if (msg.includes('shortcut') || msg.includes('accelerator')) {
    return 'SHORTCUT';
  }
  if (msg.includes('character') || msg.includes('角色')) {
    return 'CHARACTER';
  }
  if (msg.includes('screenshot') || msg.includes('capture')) {
    return 'SCREENSHOT';
  }
  return 'UNKNOWN';
}

/**
 * 获取友好错误提示文本
 */
function getFriendlyMessage(error, context) {
  const type = classifyError(error);
  const base = ERROR_MESSAGES[type] || ERROR_MESSAGES.UNKNOWN;
  return context ? `${context}：${base}` : base;
}

/**
 * 统一处理异常：记录日志 + 通过桌宠弹窗展示友好提示
 * @param {Error} error - 原始错误
 * @param {string} context - 发生错误的上下文描述
 * @param {Function} [showFn] - 可选的弹窗展示函数（如 createPetStatusWindow）
 */
function handleError(error, context, showFn) {
  const friendlyMsg = getFriendlyMessage(error, context);
  console.error(`[${context || 'Error'}]`, error);

  if (showFn) {
    try {
      showFn(friendlyMsg);
    } catch (_) {
      // 弹窗本身也失败则降级到 dialog
      showDialogError(friendlyMsg);
    }
  }

  return friendlyMsg;
}

function showDialogError(message) {
  try {
    const win = BrowserWindow.getFocusedWindow();
    dialog.showErrorBox('AI-DeskPet', message);
  } catch (_) { /* 静默降级 */ }
}

module.exports = {
  handleError,
  getFriendlyMessage,
  classifyError,
  ERROR_MESSAGES
};
