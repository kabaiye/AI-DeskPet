const OpenAI = require('openai');
const config = require('./config');
const cs = require('./characterService');

function getClient() {
    return new OpenAI({
        apiKey: config.DASHSCOPE_API_KEY,
        baseURL: config.DASHSCOPE_BASE_URL
    });
}

/**
 * 从AI响应文本中提取回退信息
 * @param {string} response - AI的原始响应文本
 * @returns {Object} 提取的响应对象
 */
function extractFallbackResponse(response) {
    // 尝试从文本中提取信息
    const lowerResponse = response.toLowerCase();

    const todoKeywords = ['任务', '待办', '会议', '截止', '计划', '工作', '项目', '清单'];
    const searchKeywords = ['文档', '文章', '代码', '学习', '资料', '教程', '笔记', '知识'];

    const shouldTodo = todoKeywords.some(keyword => lowerResponse.includes(keyword));
    const shouldSearch = searchKeywords.some(keyword => lowerResponse.includes(keyword));

    let message = response
        .replace(/#todo/gi, '')
        .replace(/#search/gi, '')
        .replace(/#other/gi, '')
        .trim();

    if (!message) {
        if (shouldTodo) {
            message = "已加入待办！✅";
        } else if (shouldSearch) {
            message = "内容已保存！📚";
        } else {
            message = "这看起来很有趣！";
        }
    }

    const actions = {
        todo: {
            shouldTrigger: shouldTodo,
            content: shouldTodo ? "待办事项" : "",
            confidence: shouldTodo ? 0.6 : 0.0
        },
        search: {
            shouldTrigger: shouldSearch,
            content: shouldSearch ? "检索内容" : "",
            confidence: shouldSearch ? 0.6 : 0.0
        }
    };

    return {
        message: message,
        emotion: shouldTodo ? '思考并怀疑' : (shouldSearch ? '猫头偷看' : '嘿嘿被夸了'),
        actions: actions
    };
}

/**
 * 获取桌宠设置
 * @returns {Object} 桌宠设置对象
 */
function getPetSettings() {
    const char = cs.getCharacter();
    return {
        petName: char.name,
        petCharacter: char.personality.default
    };
}

// 全局变量存储桌宠设置（延迟初始化，等角色配置加载后填充）
let globalPetSettings = null;

/**
 * 更新桌宠设置
 * @param {Object} settings - 新的桌宠设置
 */
function updatePetSettings(settings) {
    globalPetSettings = settings;
    console.log('Pet settings updated:', settings);
}

/**
 * 获取当前桌宠设置
 * @returns {Object} 当前桌宠设置
 */
function getCurrentPetSettings() {
    if (!globalPetSettings) {
        globalPetSettings = getPetSettings();
    }
    return globalPetSettings;
}

/**
 * 分析截图内容并生成响应
 * @param {string} base64Image - 截图的base64编码
 * @param {string} [userQuestion] - 用户附加的问题（可选）
 * @returns {Promise<Object>} 生成的响应文本
 */
async function analyzeScreenshot(base64Image, userQuestion) {
    // 即使没有配置API Key，也返回默认响应
    try {
        // 检查API Key配置
        const apiKey = config.DASHSCOPE_API_KEY;
        if (!apiKey || apiKey === "sk-xxx") {
            console.log("API Key not configured, returning default response");
            return {
                message: cs.getRandomFallback('screenshot'),
                emotion: "嘿嘿被夸了",
                actions: {
                    todo: { shouldTrigger: false, content: "", confidence: 0.0 },
                    search: { shouldTrigger: false, content: "", confidence: 0.0 }
                }
            };
        }

        console.log("Using API Key:", apiKey.substring(0, 10) + "...");
        console.log("Base URL:", config.DASHSCOPE_BASE_URL);

        console.log("Sending request to AI service...");
        console.log("Model:", "qwen-vl-plus");
        console.log("Image size:", base64Image.length, "characters");

        // 获取桌宠设置
        const petSettings = getCurrentPetSettings();
        console.log("Pet settings:", petSettings);

        const completion = await getClient().chat.completions.create({
            model: config.AI_VISION_MODEL,
            messages: [
                {
                    role: "system",
                    content: cs.getPrompt('screenshotAnalysis', { character: petSettings.petCharacter }) + `

                    请严格按照以下JSON格式回复，不要添加任何其他内容，不要包含\`\`\`json等关键字：
                    {
                    "message": "你的回应内容",
                    "actions": {
                        "todo": {
                            "shouldTrigger": true/false,
                            "content": "待办事项内容",
                            "confidence": 0.8
                        },
                        "search": {
                            "shouldTrigger": true/false,
                            "content": "检索内容描述",
                            "confidence": 0.8
                        }
                    },
                    "emotion": "表情标签"
                    }

                    其中：
                    - message: 回应内容（简体中文）
                    - actions: 各种动作的触发信息
                      - todo: 待办相关（shouldTrigger是否触发，content待办内容，confidence置信度）
                      - search: 检索相关（shouldTrigger是否触发，content检索内容，confidence置信度）
                    - emotion: 表情标签，根据截图内容选择最合适的表情，可选值：${cs.getEmotions().join('、')}`
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: userQuestion
                                ? `我刚截了一张图，我的问题是：${userQuestion}。现在是${new Date().toLocaleString('zh-CN')}，请分析截图并结合我的问题回复。`
                                : `我刚截了一张图，现在是${new Date().toLocaleString('zh-CN')}，你能看出这是什么吗？请分析并按照指定格式回复。`
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/png;base64,${base64Image}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 200,
            temperature: 0.5
        });

        console.log("AI service response received successfully");

        const aiResponse = completion.choices[0].message.content.trim();
        console.log('Raw AI response:', aiResponse);

        // 尝试解析JSON响应
        try {
            const parsedResponse = JSON.parse(aiResponse);
            console.log('Parsed JSON response:', parsedResponse);

            // 验证响应格式
            if (typeof parsedResponse.message === 'string' &&
                parsedResponse.actions &&
                typeof parsedResponse.emotion === 'string') {

                const result = {
                    message: parsedResponse.message,
                    emotion: parsedResponse.emotion,
                    actions: parsedResponse.actions
                };
                console.log('Valid JSON response:', result);
                return result;
            } else {
                throw new Error('Invalid response format');
            }
        } catch (parseError) {
            console.error('Failed to parse AI response as JSON:', parseError);
            console.log('Raw AI response:', aiResponse);

            // 如果JSON解析失败，尝试从文本中提取信息
            const fallbackResponse = extractFallbackResponse(aiResponse);
            console.log('Fallback response:', fallbackResponse);
            return fallbackResponse;
        }
    } catch (error) {
        console.error('Error occurred during AI screenshot analysis:', error);
        return {
            message: cs.getRandomFallback('screenshot'),
            emotion: "嘿嘿被夸了",
            actions: {
                todo: { shouldTrigger: false, content: "", confidence: 0.0 },
                search: { shouldTrigger: false, content: "", confidence: 0.0 }
            }
        };
    }
}

/**
 * 生成趣味提醒内容
 * @param {Date} currentTime - 当前时间，用于生成合适的时间相关提醒
 * @returns {Promise<string>} 生成的提醒文本
 */
async function generateFunReminder(currentTime = new Date()) {
    // 获取桌宠设置
    const petSettings = getCurrentPetSettings();

    // 获取当前时间信息
    const hour = currentTime.getHours();
    const minute = currentTime.getMinutes();

    // 根据时间生成合适的问候语
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

    // 即使没有配置API Key，也返回默认提醒
    try {
        // 如果没有配置API Key，则返回默认提醒
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx") {
            console.log("API Key not configured, returning default reminder");
            return cs.getRandomFallback('reminder', { timeGreeting });
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: cs.getPrompt('funReminder', {
                        character: petSettings.petCharacter,
                        hour: hour,
                        minute: minute.toString().padStart(2, '0'),
                        timeGreeting: timeGreeting
                    })
                },
                {
                    role: "user",
                    content: `现在是${timeGreeting}，给我生成一个有趣的提醒消息`
                }
            ],
            max_tokens: 80
        });

        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error occurred during AI reminder generation:', error);
        // 出错时返回默认提醒
        return cs.getRandomFallback('reminder', { timeGreeting });
    }
}

/**
 * 生成喝水提醒内容
 * @returns {Promise<string>} 生成的喝水提醒文本
 */
async function generateWaterReminder() {
    // 获取桌宠设置
    const petSettings = getCurrentPetSettings();

    // 即使没有配置API Key，也返回默认提醒
    try {
        // 如果没有配置API Key，则返回默认提醒
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx") {
            console.log("API Key not configured, returning default water reminder");
            return cs.getRandomFallback('waterReminder');
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: cs.getPrompt('waterReminder', { character: petSettings.petCharacter })
                },
                {
                    role: "user",
                    content: "提醒用户该喝水了"
                }
            ],
            max_tokens: 80
        });

        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error occurred during AI water reminder generation:', error);
        // 出错时返回默认提醒
        return cs.getRandomFallback('waterReminder');
    }
}

/**
 * 生成久坐提醒内容
 * @returns {Promise<string>} 生成的久坐提醒文本
 */
async function generateInactivityReminder() {
    // 获取桌宠设置
    const petSettings = getCurrentPetSettings();

    // 即使没有配置API Key，也返回默认提醒
    try {
        // 如果没有配置API Key，则返回默认提醒
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx") {
            console.log("API Key not configured, returning default inactivity reminder");
            return cs.getRandomFallback('inactivityReminder');
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: cs.getPrompt('inactivityReminder', { character: petSettings.petCharacter })
                },
                {
                    role: "user",
                    content: "提醒用户该起来活动了"
                }
            ],
            max_tokens: 80
        });

        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error occurred during AI inactivity reminder generation:', error);
        // 出错时返回默认提醒
        return cs.getRandomFallback('inactivityReminder');
    }
}

// 对话历史记录（按会话维护）
let chatHistory = [];
const MAX_CHAT_HISTORY = 20;

/**
 * 与桌宠进行多轮对话
 * @param {string} userMessage - 用户输入的消息
 * @returns {Promise<string>} 桌宠的回复
 */
async function chatWithPet(userMessage) {
    const petSettings = getCurrentPetSettings();

    const msgTime = new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    chatHistory.push({ role: 'user', content: `[${msgTime}] ${userMessage}` });

    if (chatHistory.length > MAX_CHAT_HISTORY * 2) {
        chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY * 2);
    }

    try {
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx") {
            console.log("API Key not configured, returning default chat response");
            const reply = cs.getRandomFallback('chat');
            chatHistory.push({ role: 'assistant', content: reply });
            return reply;
        }

        const now = new Date();
        const currentTimeStr = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' });

        const systemPrompt = cs.getPrompt('chat', {
            character: petSettings.petCharacter,
            currentTime: currentTimeStr
        }) + `\n例如：
   - 主人说"提醒我下午3点开会" → 你回复"好的喵，到点了我叫你！\n/addSchedule 开会||${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} 15:00"
   - 主人说"明天上午10点交报告" → 你回复"记住啦！明天我盯着你～\n/addSchedule 交报告||明天对应的具体日期 10:00"
   - 如果主人没有提及具体时间，可根据语义合理推断，实在无法推断则用当前时间往后1小时
   - 如果对话不涉及待办或提醒，绝对不要添加 /addSchedule 标记`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory
        ];

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: messages,
            max_tokens: 150,
            temperature: 0.8
        });

        const reply = completion.choices[0].message.content.trim();
        chatHistory.push({ role: 'assistant', content: reply });
        return reply;
    } catch (error) {
        console.error('Error in chatWithPet:', error);
        const fallback = cs.getRandomFallback('chatError');
        chatHistory.push({ role: 'assistant', content: fallback });
        return fallback;
    }
}

/**
 * 清空对话历史
 */
function clearChatHistory() {
    chatHistory = [];
    console.log('Chat history cleared');
}

function getEMOTIONS() { return cs.getEmotions(); }

/**
 * 生成主动情境问候（根据时间、星期、场景）
 * @param {Object} context - {hour, dayOfWeek, isLateNight, daysCompanion}
 * @returns {Promise<{message: string, emotion: string}>}
 */
async function generateProactiveGreeting(context) {
    const petSettings = getCurrentPetSettings();
    const { hour, dayOfWeek, isLateNight, daysCompanion } = context;

    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const dayName = dayNames[dayOfWeek];

    let scenario = '';
    if (isLateNight) scenario = '主人深夜还在电脑前，你很担心ta的身体';
    else if (hour >= 5 && hour < 8) scenario = '清晨时光，主人刚开始新的一天';
    else if (hour >= 8 && hour < 12) scenario = `${dayName}上午，主人在工作/学习`;
    else if (hour >= 12 && hour < 14) scenario = '午饭时间，提醒主人吃饭';
    else if (hour >= 14 && hour < 18) scenario = `${dayName}下午，主人可能有点犯困`;
    else if (hour >= 18 && hour < 20) scenario = '傍晚时分，主人可能刚结束工作';
    else scenario = '晚上了，主人还在电脑前';

    if (dayOfWeek === 1) scenario += '（周一，新的一周开始）';
    else if (dayOfWeek === 5 && hour >= 16) scenario += '（周五快下班了！）';
    else if (dayOfWeek === 0 || dayOfWeek === 6) scenario += '（周末时光）';

    try {
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx" || config.DASHSCOPE_API_KEY === "your_zhipu_api_key_here") {
            return _fallbackGreeting(petSettings, context);
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: cs.getPrompt('proactiveGreeting', {
                        character: petSettings.petCharacter,
                        scenario: scenario,
                        companionInfo: daysCompanion ? `你们已经相伴${daysCompanion}天了。` : ''
                    })
                },
                { role: "user", content: "主动跟主人打个招呼吧" }
            ],
            max_tokens: 100,
            temperature: 0.95
        });

        return _parseEmotionResponse(completion.choices[0].message.content.trim(), petSettings);
    } catch (error) {
        console.error('Error generating proactive greeting:', error);
        return _fallbackGreeting(petSettings, context);
    }
}

/**
 * 生成随机碎碎念（桌宠的内心活动）
 * @returns {Promise<{message: string, emotion: string}>}
 */
async function generateRandomThought() {
    const petSettings = getCurrentPetSettings();

    const topic = cs.getRandomThoughtTopic();

    try {
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx" || config.DASHSCOPE_API_KEY === "your_zhipu_api_key_here") {
            return _fallbackThought(petSettings);
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: cs.getPrompt('randomThought', {
                        character: petSettings.petCharacter,
                        topic: topic
                    })
                },
                { role: "user", content: "说说你在想什么" }
            ],
            max_tokens: 100,
            temperature: 1.0
        });

        return _parseEmotionResponse(completion.choices[0].message.content.trim(), petSettings);
    } catch (error) {
        console.error('Error generating random thought:', error);
        return _fallbackThought(petSettings);
    }
}

/**
 * 生成陪伴里程碑消息
 * @param {number} days - 陪伴天数
 * @returns {Promise<{message: string, emotion: string}>}
 */
async function generateMilestoneMessage(days) {
    const petSettings = getCurrentPetSettings();

    try {
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx" || config.DASHSCOPE_API_KEY === "your_zhipu_api_key_here") {
            return { message: cs.renderMessage(cs.getCharacter().fallbacks.milestone, { days }), emotion: '给你花花' };
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: cs.getPrompt('milestone', {
                        character: petSettings.petCharacter,
                        days: days
                    })
                },
                { role: "user", content: `庆祝陪伴第${days}天` }
            ],
            max_tokens: 80,
            temperature: 0.8
        });

        return _parseEmotionResponse(completion.choices[0].message.content.trim(), petSettings);
    } catch (error) {
        console.error('Error generating milestone message:', error);
        return { message: cs.renderMessage(cs.getCharacter().fallbacks.milestoneFallback, { days }), emotion: '给你花花' };
    }
}

function _parseEmotionResponse(raw, petSettings) {
    try {
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const emotion = getEMOTIONS().includes(parsed.emotion) ? parsed.emotion : '嘿嘿被夸了';
        const fallbackMsg = cs.getRandomFallback('parseFallback');
        return { message: parsed.message || fallbackMsg, emotion };
    } catch {
        const fallbackMsg = cs.getRandomFallback('parseFallback');
        return { message: raw.substring(0, 40) || fallbackMsg, emotion: '嘿嘿被夸了' };
    }
}

function _fallbackGreeting(petSettings, context) {
    const greetings = cs.getCharacter().fallbacks.greetings;
    let key = 'default';
    if (context.isLateNight) key = 'lateNight';
    else if (context.hour >= 5 && context.hour < 9) key = 'earlyMorning';
    else if (context.hour >= 12 && context.hour < 14) key = 'lunchTime';
    else if (context.dayOfWeek === 5 && context.hour >= 16) key = 'fridayAfternoon';
    else if (context.dayOfWeek === 1 && context.hour < 12) key = 'mondayMorning';
    return cs.renderEmotionMessage(greetings[key]);
}

function _fallbackThought(petSettings) {
    return cs.getRandomFallbackWithEmotion('thoughts');
}

// 互动触发语和连戳升级均从角色配置加载

// 戳一戳会话记忆：保留 10 分钟
let pokeSessionMessages = [];
let pokeSessionTimer = null;
const POKE_SESSION_TTL = 10 * 60 * 1000;

function resetPokeSession() {
    pokeSessionMessages = [];
    if (pokeSessionTimer) clearTimeout(pokeSessionTimer);
    pokeSessionTimer = null;
}

function touchPokeSession() {
    if (pokeSessionTimer) clearTimeout(pokeSessionTimer);
    pokeSessionTimer = setTimeout(resetPokeSession, POKE_SESSION_TTL);
}

/**
 * 生成互动反应（戳/拍/摸/闲聊）
 * @param {number} pokeCount - 短期内的互动次数
 * @returns {Promise<{message: string, emotion: string}>}
 */
async function generatePokeReaction(pokeCount) {
    const petSettings = getCurrentPetSettings();
    const trigger = cs.getRandomInteractionTrigger();

    let scenario = trigger.scenario;
    if (pokeCount > 1) {
        const escalationExtra = cs.getPokeEscalation(pokeCount);
        if (escalationExtra) {
            scenario = `主人已经连续骚扰你${pokeCount}次了（这次是：${trigger.action}）${escalationExtra}`;
        }
    }

    console.log(`[Poke] Trigger: "${trigger.action}" | Scenario: ${scenario}`);

    try {
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx" || config.DASHSCOPE_API_KEY === "your_zhipu_api_key_here") {
            return _fallbackPokeReaction(petSettings, pokeCount, trigger);
        }

        const systemMsg = {
            role: "system",
            content: cs.getPrompt('pokeReaction', {
                character: petSettings.petCharacter,
                scenario: scenario
            })
        };
        const userMsg = { role: "user", content: trigger.action };

        const messages = [systemMsg, ...pokeSessionMessages, userMsg];

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages,
            max_tokens: 100,
            temperature: 1.0
        });

        const rawReply = completion.choices[0].message.content.trim();

        pokeSessionMessages.push(userMsg);
        pokeSessionMessages.push({ role: "assistant", content: rawReply });
        // 最多保留最近 20 条（10 轮），避免 token 过长
        if (pokeSessionMessages.length > 20) {
            pokeSessionMessages = pokeSessionMessages.slice(-20);
        }
        touchPokeSession();

        return _parseEmotionResponse(rawReply, petSettings);
    } catch (error) {
        console.error('Error generating poke reaction:', error);
        return _fallbackPokeReaction(petSettings, pokeCount, trigger);
    }
}

function _fallbackPokeReaction(petSettings, pokeCount, trigger) {
    return cs.getPokeFallback(pokeCount, trigger);
}

module.exports = {
    analyzeScreenshot,
    generateFunReminder,
    generateWaterReminder,
    generateInactivityReminder,
    updatePetSettings,
    getCurrentPetSettings,
    chatWithPet,
    clearChatHistory,
    generateProactiveGreeting,
    generateRandomThought,
    generateMilestoneMessage,
    generatePokeReaction
};