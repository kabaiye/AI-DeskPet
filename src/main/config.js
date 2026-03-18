require('dotenv').config();

const DEFAULTS = {
    DASHSCOPE_API_KEY: "",
    DASHSCOPE_BASE_URL: "https://open.bigmodel.cn/api/paas/v4/",
    AI_TEXT_MODEL: "glm-4-flash-250414",
    AI_VISION_MODEL: "glm-4v-flash"
};

let runtimeApiKey = null;

function loadApiKeyFromStorage() {
    try {
        const storage = require('./storageService');
        const settings = storage.load('settings', {});
        if (settings.apiKey) {
            runtimeApiKey = settings.apiKey;
        }
    } catch (_) {
        // storageService may not be ready during early require
    }
}

function getApiKey() {
    if (runtimeApiKey) return runtimeApiKey;
    return process.env.DASHSCOPE_API_KEY || DEFAULTS.DASHSCOPE_API_KEY;
}

function setApiKey(key) {
    runtimeApiKey = key || null;
}

const DASHSCOPE_BASE_URL = process.env.DASHSCOPE_BASE_URL || DEFAULTS.DASHSCOPE_BASE_URL;
const AI_TEXT_MODEL = process.env.AI_TEXT_MODEL || DEFAULTS.AI_TEXT_MODEL;
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || DEFAULTS.AI_VISION_MODEL;

module.exports = {
    DEFAULTS,
    get DASHSCOPE_API_KEY() { return getApiKey(); },
    DASHSCOPE_BASE_URL,
    AI_TEXT_MODEL,
    AI_VISION_MODEL,
    get IS_AI_CONFIGURED() { return Boolean(getApiKey()); },
    setApiKey,
    loadApiKeyFromStorage
};
