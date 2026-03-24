/**
 * 宠物心情日记服务 — 跟踪每日互动数据并生成 AI 日记
 */
const storage = require('./storageService');

const DIARY_STORAGE_KEY = 'diary';

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getAllDiary() {
  return storage.load(DIARY_STORAGE_KEY, {});
}

const MAX_CHAT_LOGS = 50;

function createEmptyDay(dateKey) {
  return {
    date: dateKey,
    stats: {
      pokeCount: 0,
      chatCount: 0,
      screenshotCount: 0,
      todosAdded: 0,
      todosCompleted: 0,
      waterReminders: 0,
      emotionChanges: []
    },
    chatLogs: [],
    diary: null,
    generatedAt: null
  };
}

function ensureToday() {
  const diary = getAllDiary();
  const key = getTodayKey();
  if (!diary[key]) {
    diary[key] = createEmptyDay(key);
    storage.save(DIARY_STORAGE_KEY, diary);
  }
  return diary;
}

function recordEvent(eventType, data = {}) {
  const diary = ensureToday();
  const key = getTodayKey();
  const stats = diary[key].stats;

  switch (eventType) {
    case 'poke':
      stats.pokeCount++;
      break;
    case 'chat':
      stats.chatCount++;
      break;
    case 'screenshot':
      stats.screenshotCount++;
      break;
    case 'todoAdded':
      stats.todosAdded++;
      break;
    case 'todoCompleted':
      stats.todosCompleted++;
      break;
    case 'waterReminder':
      stats.waterReminders++;
      break;
    case 'emotion':
      if (data.emotion && !stats.emotionChanges.includes(data.emotion)) {
        stats.emotionChanges.push(data.emotion);
      }
      break;
  }

  storage.save(DIARY_STORAGE_KEY, diary);
}

/**
 * @param {'chat'|'poke'|'proactive'|'screenshot'} type
 */
function recordChatLog(type, userMsg, petReply) {
  const diary = ensureToday();
  const key = getTodayKey();
  const day = diary[key];
  if (!day.chatLogs) day.chatLogs = [];

  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  day.chatLogs.push({ time, type, user: userMsg || null, pet: petReply || null });

  if (day.chatLogs.length > MAX_CHAT_LOGS) {
    day.chatLogs = day.chatLogs.slice(-MAX_CHAT_LOGS);
  }
  storage.save(DIARY_STORAGE_KEY, diary);
}

function getChatLogs(dateKey) {
  const diary = getAllDiary();
  const day = diary[dateKey];
  return (day && day.chatLogs) || [];
}

function saveDiaryEntry(dateKey, diaryText) {
  const diary = getAllDiary();
  if (!diary[dateKey]) diary[dateKey] = createEmptyDay(dateKey);
  diary[dateKey].diary = diaryText;
  diary[dateKey].generatedAt = new Date().toISOString();
  storage.save(DIARY_STORAGE_KEY, diary);
}

function getDiaryList() {
  const diary = getAllDiary();
  return Object.keys(diary)
    .sort((a, b) => b.localeCompare(a))
    .map(key => ({
      date: key,
      stats: diary[key].stats,
      hasDiary: !!diary[key].diary,
      diary: diary[key].diary,
      generatedAt: diary[key].generatedAt
    }));
}

function getDayData(dateKey) {
  const diary = getAllDiary();
  return diary[dateKey] || null;
}

module.exports = {
  getTodayKey,
  ensureToday,
  recordEvent,
  recordChatLog,
  getChatLogs,
  saveDiaryEntry,
  getDiaryList,
  getDayData
};
