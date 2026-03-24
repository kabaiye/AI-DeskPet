require('dotenv').config();

const AI_PROVIDERS = {
    zhipu: {
        name: '智谱AI (GLM)',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
        textModels: ['glm-4-flash-250414', 'glm-4-flash', 'glm-4-air', 'glm-4-plus', 'glm-4-long'],
        visionModels: ['glm-4v-flash', 'glm-4v', 'glm-4v-plus'],
        defaultText: 'glm-4-flash-250414',
        defaultVision: 'glm-4v-flash',
        keyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
        hint: '免费模型，注册即用',
        free: true
    },
    deepseek: {
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/',
        textModels: ['deepseek-chat', 'deepseek-reasoner'],
        visionModels: ['deepseek-chat'],
        defaultText: 'deepseek-chat',
        defaultVision: 'deepseek-chat',
        keyUrl: 'https://platform.deepseek.com/api_keys',
        hint: '高性价比，注册赠送额度',
        free: false
    },
    qwen: {
        name: '通义千问 (阿里)',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
        textModels: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
        visionModels: ['qwen-vl-plus', 'qwen-vl-max'],
        defaultText: 'qwen-turbo',
        defaultVision: 'qwen-vl-plus',
        keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
        hint: '阿里云旗下，有免费额度',
        free: true
    },
    doubao: {
        name: '豆包 (字节)',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
        textModels: ['doubao-1.5-lite-32k', 'doubao-1.5-pro-32k', 'doubao-1.5-pro-256k'],
        visionModels: ['doubao-1.5-vision-pro-32k'],
        defaultText: 'doubao-1.5-lite-32k',
        defaultVision: 'doubao-1.5-vision-pro-32k',
        keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
        hint: '字节跳动旗下，有免费额度',
        free: true
    },
    moonshot: {
        name: 'Kimi (月之暗面)',
        baseUrl: 'https://api.moonshot.cn/v1/',
        textModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
        visionModels: [],
        defaultText: 'moonshot-v1-8k',
        defaultVision: '',
        keyUrl: 'https://platform.moonshot.cn/console/api-keys',
        hint: '注册赠送额度，暂不支持视觉',
        free: false
    },
    siliconflow: {
        name: '硅基流动',
        baseUrl: 'https://api.siliconflow.cn/v1/',
        textModels: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat'],
        visionModels: ['Qwen/Qwen2.5-VL-7B-Instruct'],
        defaultText: 'Qwen/Qwen2.5-7B-Instruct',
        defaultVision: 'Qwen/Qwen2.5-VL-7B-Instruct',
        keyUrl: 'https://cloud.siliconflow.cn/account/ak',
        hint: '聚合多家模型，有免费额度',
        free: true
    },
    yi: {
        name: '零一万物 (Yi)',
        baseUrl: 'https://api.lingyiwanwu.com/v1/',
        textModels: ['yi-lightning', 'yi-medium', 'yi-spark'],
        visionModels: ['yi-vision'],
        defaultText: 'yi-lightning',
        defaultVision: 'yi-vision',
        keyUrl: 'https://platform.lingyiwanwu.com/apikeys',
        hint: '注册赠送额度',
        free: false
    },
    openai: {
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1/',
        textModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        visionModels: ['gpt-4o-mini', 'gpt-4o'],
        defaultText: 'gpt-4o-mini',
        defaultVision: 'gpt-4o-mini',
        keyUrl: 'https://platform.openai.com/api-keys',
        hint: '需付费，国内需代理',
        free: false
    },
    ollama: {
        name: 'Ollama (本地)',
        baseUrl: 'http://localhost:11434/v1/',
        textModels: ['qwen2.5', 'llama3', 'gemma2', 'mistral', 'phi3'],
        visionModels: ['llava', 'llama3.2-vision'],
        defaultText: 'qwen2.5',
        defaultVision: 'llava',
        keyUrl: '',
        hint: '本地部署，API Key 填 ollama',
        free: true
    },
    custom: {
        name: '自定义',
        baseUrl: '',
        textModels: [],
        visionModels: [],
        defaultText: '',
        defaultVision: '',
        keyUrl: '',
        hint: '兼容 OpenAI API 格式的服务',
        free: false
    }
};

const DEFAULT_PROVIDER = 'zhipu';

const DEFAULTS = {
    DASHSCOPE_API_KEY: "",
    DASHSCOPE_BASE_URL: AI_PROVIDERS[DEFAULT_PROVIDER].baseUrl,
    AI_TEXT_MODEL: AI_PROVIDERS[DEFAULT_PROVIDER].defaultText,
    AI_VISION_MODEL: AI_PROVIDERS[DEFAULT_PROVIDER].defaultVision
};

let runtime = { apiKey: null, baseUrl: null, textModel: null, visionModel: null, provider: null };

function loadModelConfig() {
    try {
        const storage = require('./storageService');
        const settings = storage.load('settings', {});

        if (!settings.activeProvider && (settings.aiProvider || settings.apiKey)) {
            const pid = settings.aiProvider || DEFAULT_PROVIDER;
            settings.activeProvider = pid;
            settings.providerConfigs = settings.providerConfigs || {};
            settings.providerConfigs[pid] = {
                apiKey: settings.apiKey || '',
                baseUrl: settings.aiBaseUrl || '',
                textModel: settings.aiTextModel || '',
                visionModel: settings.aiVisionModel || ''
            };
            delete settings.aiProvider;
            delete settings.apiKey;
            delete settings.aiBaseUrl;
            delete settings.aiTextModel;
            delete settings.aiVisionModel;
            storage.save('settings', settings);
        }

        const provider = settings.activeProvider || DEFAULT_PROVIDER;
        const cfg = (settings.providerConfigs || {})[provider] || {};
        runtime.provider = provider;
        runtime.apiKey = cfg.apiKey || null;
        runtime.baseUrl = cfg.baseUrl || null;
        runtime.textModel = cfg.textModel || null;
        runtime.visionModel = cfg.visionModel || null;
    } catch (_) {}
}

function setModelConfig(cfg) {
    if (cfg.apiKey !== undefined) runtime.apiKey = cfg.apiKey || null;
    if (cfg.provider !== undefined) runtime.provider = cfg.provider || null;
    if (cfg.baseUrl !== undefined) runtime.baseUrl = cfg.baseUrl || null;
    if (cfg.textModel !== undefined) runtime.textModel = cfg.textModel || null;
    if (cfg.visionModel !== undefined) runtime.visionModel = cfg.visionModel || null;
}

function setApiKey(key) {
    runtime.apiKey = key || null;
}

module.exports = {
    AI_PROVIDERS,
    DEFAULT_PROVIDER,
    DEFAULTS,
    get DASHSCOPE_API_KEY() { return runtime.apiKey || process.env.DASHSCOPE_API_KEY || DEFAULTS.DASHSCOPE_API_KEY; },
    get DASHSCOPE_BASE_URL() { return runtime.baseUrl || process.env.DASHSCOPE_BASE_URL || DEFAULTS.DASHSCOPE_BASE_URL; },
    get AI_TEXT_MODEL() { return runtime.textModel || process.env.AI_TEXT_MODEL || DEFAULTS.AI_TEXT_MODEL; },
    get AI_VISION_MODEL() { return runtime.visionModel || process.env.AI_VISION_MODEL || DEFAULTS.AI_VISION_MODEL; },
    get IS_AI_CONFIGURED() { return Boolean(runtime.apiKey || process.env.DASHSCOPE_API_KEY); },
    get AI_PROVIDER() { return runtime.provider || DEFAULT_PROVIDER; },
    setApiKey,
    setModelConfig,
    loadApiKeyFromStorage: loadModelConfig,
    loadModelConfig
};
