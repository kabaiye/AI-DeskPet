const { Notification } = require('electron');
const { generateFunReminder, generateWaterReminder, generateInactivityReminder } = require('./aiService');
const cs = require('./characterService');
const state = require('./appState');

let createPetStatusWindowFunction = null;
let createWaterReminderWindowFunction = null;

function setCreatePetStatusWindowFunction(func) {
  createPetStatusWindowFunction = func;
}

function setCreateWaterReminderWindowFunction(func) {
  createWaterReminderWindowFunction = func;
}

class ActivityMonitor {
  constructor() {
    this.lastActivityTime = Date.now();
    this.lastWaterReminder = Date.now();
    this.lastFunReminder = Date.now();
    this.activityCheckInterval = null;
    this.checkInterval = 60 * 1000;

    this.init();
  }

  init() {
    this.startActivityCheck();
  }

  startActivityCheck() {
    this.activityCheckInterval = setInterval(async () => {
      if (state.doNotDisturb) return;

      await this.checkInactivity();
      await this.checkWaterReminder();
      await this.checkFunReminder();
    }, this.checkInterval);
  }

  updateActivity() {
    this.lastActivityTime = Date.now();
  }

  async checkInactivity() {
    if (state.sedentaryMinutes <= 0) return;
    const threshold = state.sedentaryMinutes * 60 * 1000;
    const elapsed = Date.now() - this.lastActivityTime;
    if (elapsed > threshold) {
      await this.showInactivityNotification();
      this.lastActivityTime = Date.now();
    }
  }

  async checkWaterReminder() {
    if (state.waterMinutes <= 0) return;
    const threshold = state.waterMinutes * 60 * 1000;
    const elapsed = Date.now() - this.lastWaterReminder;
    if (elapsed > threshold) {
      await this.showWaterReminder();
      this.lastWaterReminder = Date.now();
    }
  }

  async checkFunReminder() {
    const threshold = 10 * 60 * 1000;
    const elapsed = Date.now() - this.lastFunReminder;
    if (elapsed > threshold) {
      await this.showFunReminder();
      this.lastFunReminder = Date.now();
    }
  }

  async showInactivityNotification() {
    try {
      const msg = await generateInactivityReminder();
      if (createPetStatusWindowFunction) createPetStatusWindowFunction(msg);
    } catch (_) {
      if (createPetStatusWindowFunction) {
        createPetStatusWindowFunction('🏃‍♂️ 起来走两步，不然椅子会长你身上！');
      }
    }
  }

  async showWaterReminder() {
    try {
      const msg = await generateWaterReminder();
      if (createWaterReminderWindowFunction) createWaterReminderWindowFunction();
      if (createPetStatusWindowFunction) createPetStatusWindowFunction(msg);
    } catch (_) {
      const msgs = [
        '🌵 再不喝水就要变成仙人掌了！',
        '☕ 你已经很久没有喝水啦，来杯水吧～',
        '💧 水是生命之源，快来补充能量！'
      ];
      if (createWaterReminderWindowFunction) createWaterReminderWindowFunction();
      if (createPetStatusWindowFunction) {
        createPetStatusWindowFunction(msgs[Math.floor(Math.random() * msgs.length)]);
      }
    }
  }

  async showFunReminder() {
    try {
      const msg = await generateFunReminder(new Date());
      if (createPetStatusWindowFunction) createPetStatusWindowFunction(msg);
    } catch (_) {
      const hour = new Date().getHours();
      let tg = '';
      if (hour >= 5 && hour < 12) tg = '早上好';
      else if (hour >= 12 && hour < 18) tg = '下午好';
      else if (hour >= 18 && hour < 22) tg = '晚上好';
      else tg = '夜深了';
      const msg = cs.getRandomFallback('reminder', { timeGreeting: tg });
      if (createPetStatusWindowFunction) createPetStatusWindowFunction(msg);
    }
  }

  destroy() {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
    }
  }
}

module.exports = { ActivityMonitor, setCreatePetStatusWindowFunction, setCreateWaterReminderWindowFunction };
