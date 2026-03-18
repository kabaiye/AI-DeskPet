const { app, Notification, BrowserWindow } = require('electron');
const Store = require('electron-store');
const { generateFunReminder, generateWaterReminder, generateInactivityReminder } = require('./aiService');

// 全局变量：小黑文本弹窗与喝水提醒弹窗创建函数
let createPetStatusWindowFunction = null;
let createWaterReminderWindowFunction = null;

// 设置createPetStatusWindow函数的函数
function setCreatePetStatusWindowFunction(func) {
  createPetStatusWindowFunction = func;
}

// 设置创建喝水提醒窗口函数
function setCreateWaterReminderWindowFunction(func) {
  createWaterReminderWindowFunction = func;
}

class ActivityMonitor {
  constructor() {
    this.store = new Store();
    this.lastActivityTime = Date.now();
    this.lastWaterReminder = Date.now();
    this.lastFunReminder = Date.now();
    this.activityCheckInterval = null;
    this.inactivityThreshold = 52 * 60 * 1000; // 52分钟
    this.waterReminderThreshold = 60 * 60 * 1000; // 52分钟
    this.funReminderThreshold = 10 * 60 * 1000; // 10分钟
    this.checkInterval = 60 * 1000; // 每60秒检查一次 

    this.init();
  }

  init() {
    // 监听用户活动
    this.startActivityListener();

    // 启动定时检查
    this.startActivityCheck();
  }

  startActivityListener() {
    // 监听全局鼠标和键盘事件
    const { globalShortcut } = require('electron');

    // 使用节流方式监听活动
    const events = ['mousedown', 'mousemove', 'keydown', 'wheel'];

    events.forEach(eventType => {
      // 在主窗口中监听事件
      // 注意：实际应用中需要在渲染进程中监听这些事件并通过IPC通信
    });
  }

  startActivityCheck() {
    this.activityCheckInterval = setInterval(async () => {
      await this.checkInactivity();
      await this.checkWaterReminder();
      await this.checkFunReminder();
    }, this.checkInterval);
  }

  // 更新活动时间
  updateActivity() {
    this.lastActivityTime = Date.now();
  }

  // 检查不活动状态
  async checkInactivity() {
    const now = Date.now();
    const inactiveDuration = now - this.lastActivityTime;

    // 如果超过设定时间未活动
    if (inactiveDuration > this.inactivityThreshold) {
      await this.showInactivityNotification();
      // 重置活动时间，避免连续提醒
      this.lastActivityTime = now;
    }
  }

  // 检查喝水提醒
  async checkWaterReminder() {
    const now = Date.now();
    const waterDuration = now - this.lastWaterReminder;

    // 如果超过设定时间未喝水
    if (waterDuration > this.waterReminderThreshold) {
      await this.showWaterReminder();
      // 重置喝水时间
      this.lastWaterReminder = now;
    }
  }

  // 检查趣味提醒
  async checkFunReminder() {
    const now = Date.now();
    const funDuration = now - this.lastFunReminder;

    // 如果超过设定时间
    if (funDuration > this.funReminderThreshold) {
      await this.showFunReminder();
      // 重置趣味提醒时间
      this.lastFunReminder = now;
    }
  }

  // 显示不活动提醒
  async showInactivityNotification() {
    try {
      // 使用AI生成久坐提醒内容
      const aiMessage = await generateInactivityReminder();

      if (createPetStatusWindowFunction) {
        createPetStatusWindowFunction(aiMessage);
      }
    } catch (error) {
      console.error('Failed to generate AI inactivity reminder:', error);
      // 出错时使用默认提醒
      const message = '🏃‍♂️ 起来走两步，不然椅子会长你身上！';
      if (createPetStatusWindowFunction) {
        createPetStatusWindowFunction(message);
      }
    }
  }

  // 显示喝水提醒
  async showWaterReminder() {
    try {
      // 使用AI生成喝水提醒内容
      const aiMessage = await generateWaterReminder();

      // 同时显示喝水提醒窗口和消息提醒
      if (createWaterReminderWindowFunction) {
        createWaterReminderWindowFunction();
      }

      // 同时显示AI生成的消息提醒
      if (createPetStatusWindowFunction) {
        createPetStatusWindowFunction(aiMessage);
      }
    } catch (error) {
      console.error('Failed to generate AI water reminder:', error);
      // 出错时使用默认提醒
      const messages = [
        '🌵 再不喝水就要变成仙人掌了！',
        '☕ 你已经很久没有喝水啦，来杯水吧～',
        '💧 水是生命之源，快来补充能量！'
      ];

      const message = messages[Math.floor(Math.random() * messages.length)];

      // 同时显示喝水提醒窗口和消息提醒
      if (createWaterReminderWindowFunction) {
        createWaterReminderWindowFunction();
      }

      if (createPetStatusWindowFunction) {
        createPetStatusWindowFunction(message);
      }
    }
  }

  // 显示趣味提醒（使用小黑窗口）
  async showFunReminder() {
    try {
      // 使用AI生成趣味提醒内容，传入当前时间
      const currentTime = new Date();
      const aiMessage = await generateFunReminder(currentTime);

      if (createPetStatusWindowFunction) {
        createPetStatusWindowFunction(aiMessage);
      }
    } catch (error) {
      console.error('Failed to generate AI fun reminder:', error);
      // 出错时使用默认提醒
      const currentTime = new Date();
      const hour = currentTime.getHours();

      let timeGreeting = '';
      if (hour >= 5 && hour < 12) {
        timeGreeting = '早上好';
      } else if (hour >= 12 && hour < 18) {
        timeGreeting = '下午好';
      } else if (hour >= 18 && hour < 22) {
        timeGreeting = '晚上好';
      } else {
        timeGreeting = '夜深了';
      }

      const messages = [
        `${timeGreeting}！工作累了吗？休息一下吧～✨`,
        '觉得你工作很认真呢！继续保持！💪',
        '想和你聊聊天～有什么有趣的事情吗？😊',
        '发现你专注的样子很可爱呢！🌟',
        '提醒你该放松一下啦！深呼吸～🌬️',
        '觉得你的努力一定会得到回报的！加油！🚀'
      ];

      const message = messages[Math.floor(Math.random() * messages.length)];

      if (createPetStatusWindowFunction) {
        createPetStatusWindowFunction(message);
      }
    }
  }

  // 显示旅程状态
  showJourneyStatus() {
    const notification = {
      title: '旅程状态',
      body: '你的小黑正在冰岛看极光呢！预计还有15小时到达 🌌',
      icon: 'icon.png'
    };

    if (Notification.isSupported()) {
      new Notification(notification).show();
    }
  }

  // 显示喝水提醒窗口
  showWaterReminderWindow() {
    // 这里应该通过IPC与主进程通信来创建窗口
    // 为简化代码，在主进程中直接处理窗口创建
  }

  // 清理资源
  destroy() {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
    }
  }
}

module.exports = { ActivityMonitor, setCreatePetStatusWindowFunction, setCreateWaterReminderWindowFunction };