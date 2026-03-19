const Store = require('electron-store');
const {
    generateProactiveGreeting,
    generateRandomThought,
    generateMilestoneMessage
} = require('./aiService');
const state = require('./appState');

const store = new Store();

// 里程碑天数
const MILESTONE_DAYS = [1, 3, 7, 14, 30, 60, 100, 180, 365];

// 各行为的间隔范围（毫秒）
const THOUGHT_MIN_INTERVAL = 20 * 60 * 1000;  // 最少 20 分钟
const THOUGHT_MAX_INTERVAL = 45 * 60 * 1000;  // 最多 45 分钟
const LATE_NIGHT_CHECK = 30 * 60 * 1000;      // 深夜关怀每 30 分钟检查

let thoughtTimer = null;
let lateNightTimer = null;
let showMessageFn = null;
let changeEmotionFn = null;

function init(options) {
    showMessageFn = options.showMessage;
    changeEmotionFn = options.changeEmotion;

    recordFirstLaunch();
    scheduleStartupGreeting();
    scheduleRandomThoughts();
    scheduleLateNightCare();

    console.log('Proactive personality engine initialized');
}

function recordFirstLaunch() {
    if (!store.get('firstLaunchDate')) {
        store.set('firstLaunchDate', new Date().toISOString());
        console.log('First launch recorded');
    }
}

function getCompanionDays() {
    const first = store.get('firstLaunchDate');
    if (!first) return 0;
    const diff = Date.now() - new Date(first).getTime();
    return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

// 启动问候（延迟 5 秒，等窗口就绪）
function scheduleStartupGreeting() {
    setTimeout(async () => {
        const days = getCompanionDays();

        // 检查是否是里程碑日
        const lastMilestone = store.get('lastMilestoneDay', 0);
        if (MILESTONE_DAYS.includes(days) && lastMilestone !== days) {
            store.set('lastMilestoneDay', days);
            try {
                const result = await generateMilestoneMessage(days);
                emitMessage(result);
                return;
            } catch (e) {
                console.error('Milestone message failed:', e);
            }
        }

        // 普通情境问候
        const now = new Date();
        const context = {
            hour: now.getHours(),
            dayOfWeek: now.getDay(),
            isLateNight: now.getHours() >= 23 || now.getHours() < 5,
            daysCompanion: days
        };

        try {
            const result = await generateProactiveGreeting(context);
            emitMessage(result);
        } catch (e) {
            console.error('Startup greeting failed:', e);
        }
    }, 5000);
}

// 随机碎碎念定时器
function scheduleRandomThoughts() {
    function nextThought() {
        const delay = THOUGHT_MIN_INTERVAL + Math.random() * (THOUGHT_MAX_INTERVAL - THOUGHT_MIN_INTERVAL);
        thoughtTimer = setTimeout(async () => {
            const hour = new Date().getHours();
            if (state.doNotDisturb || (hour >= 1 && hour < 7)) {
                nextThought();
                return;
            }

            try {
                const result = await generateRandomThought();
                emitMessage(result);
            } catch (e) {
                console.error('Random thought failed:', e);
            }

            nextThought();
        }, delay);
    }

    nextThought();
}

// 深夜关怀
function scheduleLateNightCare() {
    let lastLateNightMsg = 0;

    lateNightTimer = setInterval(async () => {
        const hour = new Date().getHours();
        const now = Date.now();

        if (!state.doNotDisturb && (hour >= 23 || hour < 4) && (now - lastLateNightMsg > 60 * 60 * 1000)) {
            lastLateNightMsg = now;

            const context = {
                hour,
                dayOfWeek: new Date().getDay(),
                isLateNight: true,
                daysCompanion: getCompanionDays()
            };

            try {
                const result = await generateProactiveGreeting(context);
                emitMessage(result);
            } catch (e) {
                console.error('Late night care failed:', e);
            }
        }
    }, LATE_NIGHT_CHECK);
}

function emitMessage(result) {
    if (!result || !result.message) return;

    console.log(`[Proactive] ${result.emotion}: ${result.message}`);

    if (changeEmotionFn && result.emotion) {
        changeEmotionFn(result.emotion);
    }

    if (showMessageFn) {
        showMessageFn(result.message);
    }

    // 8 秒后恢复默认表情
    if (changeEmotionFn) {
        setTimeout(() => changeEmotionFn(null), 8000);
    }
}

function destroy() {
    if (thoughtTimer) { clearTimeout(thoughtTimer); thoughtTimer = null; }
    if (lateNightTimer) { clearInterval(lateNightTimer); lateNightTimer = null; }
    console.log('Proactive engine destroyed');
}

module.exports = { init, destroy, getCompanionDays };
