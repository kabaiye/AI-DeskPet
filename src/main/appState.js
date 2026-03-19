/**
 * 应用共享状态 — 所有模块通过引用此对象来访问/修改全局状态
 */
module.exports = {
  mainWindow: null,
  petWindow: null,
  bubbleWindow: null,
  waterReminderWindow: null,
  todoWindow: null,
  petSettingsWindow: null,
  contextMenuWindow: null,
  transparencyWindow: null,
  chatWindow: null,
  quickChatWindow: null,
  screenshotQuestionWindow: null,
  characterCreatorWindow: null,
  petStatusWindow: null,
  screenshots: null,

  chatDisplayMessages: [],
  pendingScreenshotBase64: null,
  pendingEditCharId: null,

  // 拖动
  isDragging: false,
  dragOffset: { x: 0, y: 0 },
  dragInterval: null,

  // 桌宠状态
  petStateTimer: null,
  currentPetEmotion: null,
  PET_STATE_DURATION: 5000,
  currentPetTransparency: 100,

  // 待办提醒
  todoReminderTimer: null,
  lastTodoReminderTime: 0,
  TODO_REMINDER_INTERVAL: 30 * 60 * 1000,
  todoReminderTimers: new Map(),

  // 戳一戳
  pokeCount: 0,
  pokeDebounceTimer: null,
  pokeResetTimer: null,
  pokeProcessing: false,
  POKE_DEBOUNCE_MS: 800,
  POKE_COUNT_RESET_MS: 30000,

  // 快捷聊天
  quickChatHistory: [],
  quickChatLastTime: 0,
  QUICK_CHAT_CONTEXT_TTL: 5 * 60 * 1000,

  // 活动监控实例
  activityMonitor: null,

  // 勿扰模式 & 提醒间隔（分钟，0 = 关闭）
  doNotDisturb: false,
  sedentaryMinutes: 52,
  waterMinutes: 60,
};
