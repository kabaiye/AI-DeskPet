const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let currentCharacter = null;

function getCharactersDir() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'characters');
    }
    return path.join(__dirname, '..', '..', 'characters');
}

function getAssetsDir() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'assets');
    }
    return path.join(__dirname, '..', 'assets', 'imgs');
}

function loadCharacter(characterId = 'xiaohei') {
    const charPath = path.join(getCharactersDir(), `${characterId}.json`);
    try {
        const raw = fs.readFileSync(charPath, 'utf-8');
        currentCharacter = JSON.parse(raw);
        console.log(`Character loaded: ${currentCharacter.name} (${currentCharacter.id})`);
        return currentCharacter;
    } catch (error) {
        console.error(`Failed to load character "${characterId}":`, error);
        throw error;
    }
}

function getCharacter() {
    if (!currentCharacter) {
        loadCharacter();
    }
    return currentCharacter;
}

function renderTemplate(template, vars = {}) {
    if (!template) return '';
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return vars[key] !== undefined ? vars[key] : match;
    });
}

function renderMessage(template, extraVars = {}) {
    const char = getCharacter();
    const vars = { name: char.name, ...extraVars };
    return renderTemplate(template, vars);
}

function renderEmotionMessage(item, extraVars = {}) {
    return {
        message: renderMessage(item.message, extraVars),
        emotion: item.emotion
    };
}

function getAssetPath(filename) {
    const char = getCharacter();
    return path.join(getAssetsDir(), char.assets.baseDir, filename);
}

function getEmotionFile(value) {
    return typeof value === 'string' ? value : value.file;
}

function getEmotionMap() {
    const char = getCharacter();
    const map = {};
    for (const [emotion, value] of Object.entries(char.assets.emotions)) {
        if (emotion.startsWith('_')) continue;
        map[emotion] = getAssetPath(getEmotionFile(value));
    }
    return map;
}

// ====== 提示词构建 ======
// 功能性规则（输出格式、字数限制等）硬编码在此处，角色风格从 JSON 的 style 字段读取

const PROMPT_BUILDERS = {
    screenshotAnalysis(char, vars) {
        return `${vars.character}\n\n人类会发送截图给你，你需要分析截图内容并给出回应。\n\n分析规则：\n1. 待办记录：如果截图包含任务清单、会议安排、截止日期、工作计划等需要记录的事项，建议记录待办\n2. 内容检索：如果截图包含文档、文章、代码、学习资料等需要保存或检索的内容，建议内容检索\n3. 日常互动：${char.style.screenshot}\n4. 回应应该简短、有趣且富有想象力，不超过20个字\n5. 记住你的名字是${char.name}，在回应中保持你的性格特点`;
    },

    funReminder(char, vars) {
        return `${vars.character}\n\n你是${char.name}，一个有趣的桌面伴侣助手。现在时间是${vars.hour}:${vars.minute}，${vars.timeGreeting}。\n\n你需要生成一些有趣的提醒消息，比如鼓励、幽默或温馨的提醒。注意：\n1. 不要生成关于喝水或久坐的提醒（这些由专门的提醒处理）\n2. 根据当前时间生成合适的问候语\n3. 保持简短，不超过25个字\n4. ${char.style.reminder}\n5. 可以是工作鼓励、生活感悟、轻松话题等`;
    },

    waterReminder(char, vars) {
        return `${vars.character}\n\n你是${char.name}，一个有趣的桌面伴侣助手。你需要生成一个提醒用户喝水的消息。保持简短，不超过30个字。${char.style.reminder}`;
    },

    inactivityReminder(char, vars) {
        return `${vars.character}\n\n你是${char.name}，一个有趣的桌面伴侣助手。你需要生成一个提醒用户起来活动的消息。保持简短，不超过30个字。${char.style.reminder}`;
    },

    chat(char, vars) {
        return `${vars.character}\n\n你是${char.name}，正在和主人聊天。当前时间：${vars.currentTime}。\n\n回复风格：${char.style.chat}\n回复要求：\n1. 回复简洁自然，像朋友聊天一样，一般不超过100字\n2. 可以使用少量表情符号增加趣味\n3. 记住之前的对话内容，保持连贯\n\n[系统功能规则 - 严格遵守]\n判断主人的消息是否包含需要创建待办或日程提醒的意图（如提醒我、记一下、别忘了、下午3点要、明天、帮我安排等）。如果是，请在回复的最末尾另起一行添加标记，格式为：\n/addSchedule 待办内容||YYYY-MM-DD HH:mm\n其中时间必须使用24小时制，根据当前时间推算出具体的年月日时分。`;
    },

    proactiveGreeting(char, vars) {
        return `${vars.character}\n你是${char.name}，主人的桌面伙伴。现在你要主动跟主人说话。\n场景：${vars.scenario}\n${vars.companionInfo}\n\n${char.style.greeting}\n不超过30字。\n同时从以下表情中选一个最合适的：${vars.emotionList}\n\n请严格按JSON格式回复：{"message":"你的话","emotion":"表情名"}`;
    },

    randomThought(char, vars) {
        return `${vars.character}\n你是${char.name}，一只有自己思想的桌面伙伴。你现在想跟主人分享一些内心的碎碎念。\n\n要求：\n1. 话题方向：${vars.topic}\n2. ${char.style.thought}\n3. 不超过35字\n4. 从以下表情选一个：${vars.emotionList}\n\n请严格按JSON格式回复：{"message":"你的碎碎念","emotion":"表情名"}`;
    },

    milestone(char, vars) {
        return `${vars.character}\n你是${char.name}。今天是你陪伴主人的第${vars.days}天！${char.style.milestone}\n不超过35字。\n从以下表情选一个：${vars.emotionList}\n\n请严格按JSON格式回复：{"message":"你的纪念感言","emotion":"表情名"}`;
    },

    pokeReaction(char, vars) {
        return `${vars.character}\n你是${char.name}。${vars.scenario}。\n\n要求：\n1. 根据主人的动作或话语，给出一个自然、有趣的回应\n2. 展现你的个性：${char.style.poke}\n3. 不超过25字，口语化，像真的在和主人聊天\n4. 从以下表情选一个最合适的：${vars.emotionList}\n5. 【重要】每次回复必须和之前的不同，不要重复已说过的话，尽量变换表达方式、语气和表情\n\n请严格按JSON格式回复：{"message":"你的回应","emotion":"表情名"}`;
    },

    diary(char, vars) {
        return `${vars.character}\n你是${char.name}，正在写今天的心情日记。日期：${vars.date}\n\n${vars.summary}\n\n要求：\n1. 以第一人称（"我"）写一篇150-300字的心情日记\n2. 重点参考对话记录中的实际内容，写出真实发生的事情和你的感受，而不是泛泛地描述数字\n3. ${char.style.thought}\n4. 语气温暖、有个性，带有你独特的口吻\n5. 如果某项数据为0可以不提，聚焦有互动的部分\n6. 可以引用或化用对话中有趣、感动、印象深刻的片段\n7. 可以加入对主人的小心思、对明天的期待\n8. 不要用列表格式，写成流畅的日记文字`;
    }
};

function getPrompt(promptKey, vars = {}) {
    const char = getCharacter();
    const builder = PROMPT_BUILDERS[promptKey];
    if (!builder) {
        console.warn(`Prompt builder "${promptKey}" not found`);
        return '';
    }
    const fullVars = {
        name: char.name,
        emotionList: char.emotions.join('、'),
        ...vars
    };
    return builder(char, fullVars);
}

// ====== Fallback 消息 ======

function getRandomFallback(category, vars = {}) {
    const char = getCharacter();
    const messages = char.fallbacks[category];
    if (!messages) return '';
    if (Array.isArray(messages)) {
        const template = messages[Math.floor(Math.random() * messages.length)];
        return renderMessage(template, vars);
    }
    return renderMessage(messages, vars);
}

function getRandomFallbackWithEmotion(category, vars = {}) {
    const char = getCharacter();
    const items = char.fallbacks[category];
    if (!items || !Array.isArray(items)) return { message: '', emotion: '嘿嘿被夸了' };
    const item = items[Math.floor(Math.random() * items.length)];
    return renderEmotionMessage(item, vars);
}

// ====== 互动系统 ======

function getRandomInteractionTrigger() {
    const char = getCharacter();
    const triggers = char.interactions.triggers;
    const trigger = triggers[Math.floor(Math.random() * triggers.length)];
    return {
        action: renderMessage(trigger.action),
        scenario: renderMessage(trigger.scenario)
    };
}

function getPokeEscalation(pokeCount) {
    const char = getCharacter();
    const escalation = char.interactions.escalation.find(e =>
        pokeCount >= e.min && (e.max === null || pokeCount <= e.max)
    );
    return escalation ? escalation.extra : null;
}

function getPokeFallback(pokeCount, trigger) {
    const char = getCharacter();

    if (pokeCount > 6) {
        const items = char.interactions.pokeOverload;
        const item = items[Math.floor(Math.random() * items.length)];
        return renderEmotionMessage(item, { count: pokeCount });
    }

    let fallbacks = null;
    for (const [key, val] of Object.entries(char.interactions.pokeFallbacks)) {
        if (key.startsWith('_')) continue;
        if (renderMessage(key) === trigger.action) {
            fallbacks = val;
            break;
        }
    }
    if (fallbacks && fallbacks.length > 0) {
        const item = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        return renderEmotionMessage(item);
    }

    const generic = char.interactions.pokeGeneric;
    const item = generic[Math.floor(Math.random() * generic.length)];
    return renderEmotionMessage(item);
}

function getRandomThoughtTopic() {
    const char = getCharacter();
    const topics = char.thoughtTopics;
    return topics[Math.floor(Math.random() * topics.length)];
}

function getEmotions() {
    const char = getCharacter();
    return char.emotions;
}

function getCharacterForRenderer() {
    const char = getCharacter();
    return {
        id: char.id,
        name: char.name,
        displayName: char.displayName,
        subtitle: char.subtitle,
        statusOnline: char.statusOnline,
        defaultStatusMessage: char.defaultStatusMessage,
        errorFallbackMessage: char.errorFallbackMessage,
        personality: char.personality,
        assets: char.assets,
        assetsBasePath: getAssetsDir().replace(/\\/g, '/'),
        emotions: char.emotions,
        waterReminderUI: char.waterReminderUI,
        ui: char.ui
    };
}

module.exports = {
    getCharactersDir,
    getAssetsDir,
    loadCharacter,
    getCharacter,
    renderTemplate,
    renderMessage,
    renderEmotionMessage,
    getAssetPath,
    getEmotionMap,
    getPrompt,
    getRandomFallback,
    getRandomFallbackWithEmotion,
    getRandomInteractionTrigger,
    getPokeEscalation,
    getPokeFallback,
    getRandomThoughtTopic,
    getEmotions,
    getCharacterForRenderer
};
