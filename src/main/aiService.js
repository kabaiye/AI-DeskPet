const OpenAI = require('openai');
const config = require('./config');

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
    // 在Node.js环境中，我们使用默认设置
    // 实际的设置会通过IPC从渲染进程传递
    return {
        petName: '小黑',
        petCharacter: '你是罗小黑，是一个幼年小猫妖，对世界充满好奇，喜欢旅行，嫉恶如仇，早安喵，午安喵，晚安喵喵喵。性格活泼可爱，喜欢卖萌，经常用可爱的语气说话，对新鲜事物充满好奇。'
    };
}

// 全局变量存储桌宠设置
let globalPetSettings = getPetSettings();

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
            const defaultResponses = [
                "这看起来很有趣！",
                "哇，这个不错哦！",
                "好有意思的内容！"
            ];
            return {
                message: defaultResponses[Math.floor(Math.random() * defaultResponses.length)],
                emotion: "嘿嘿被夸了",
                actions: {
                    todo: { shouldTrigger: false, content: "", confidence: 0.0 },
                    search: { shouldTrigger: false, content: "", confidence: 0.0 }
                }
            };
        }

        console.log("Using API Key:", apiKey.substring(0, 10) + "...");
        console.log("Base URL:", DASHSCOPE_BASE_URL);

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
                    content: `${petSettings.petCharacter}

                    人类会发送截图给你，你需要分析截图内容并给出回应。

                    分析规则：
                    1. 待办记录：如果截图包含任务清单、会议安排、截止日期、工作计划等需要记录的事项，建议记录待办
                    2. 内容检索：如果截图包含文档、文章、代码、学习资料等需要保存或检索的内容，建议内容检索
                    3. 日常互动：对工作文档、聊天界面、游戏、风景照片等内容，给出有趣回应，看到辛苦忙碌表达关怀，看到笑话会笑，看到好吃的就流口水肚子饿了，看到被老板PUA他是坏人气哄哄等等
                    4. 回应应该简短、有趣且富有想象力，不超过20个字
                    5. 记住你的名字是${petSettings.petName}，在回应中保持你的性格特点

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
                    - emotion: 表情标签，根据截图内容选择最合适的表情，可选值：好棒（开心夸奖）、嘿嘿被夸了（害羞开心）、给你花花（友好送花）、有瓜让我听听（好奇八卦）、猫头偷看（偷偷观察）、思考并怀疑（思考状态）、好复杂（困惑）、馋得流口水（想吃东西）、生气替你出头（愤怒保护）、哼不理你了（傲娇）、玩手机（专注玩手机）、困死了（困倦）`
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
        const defaultResponses = [
            "这看起来很有趣！",
            "哇，这个不错哦！",
            "好有意思的内容！"
        ];
        return {
            message: defaultResponses[Math.floor(Math.random() * defaultResponses.length)],
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
            const defaultReminders = [
                `${petSettings.petName}${timeGreeting}！工作累了吗？休息一下吧～✨`,
                `${petSettings.petName}觉得你工作很认真呢！继续保持！💪`,
                `${petSettings.petName}想和你聊聊天～有什么有趣的事情吗？😊`,
                `${petSettings.petName}发现你专注的样子很可爱呢！🌟`,
                `${petSettings.petName}提醒你该放松一下啦！深呼吸～🌬️`,
                `${petSettings.petName}觉得你的努力一定会得到回报的！加油！🚀`
            ];
            return defaultReminders[Math.floor(Math.random() * defaultReminders.length)];
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `${petSettings.petCharacter}

                    你是${petSettings.petName}，一个有趣的桌面伴侣助手。现在时间是${hour}:${minute.toString().padStart(2, '0')}，${timeGreeting}。

                    你需要生成一些有趣的提醒消息，比如鼓励、幽默或温馨的提醒。注意：
                    1. 不要生成关于喝水或久坐的提醒（这些由专门的提醒处理）
                    2. 根据当前时间生成合适的问候语
                    3. 保持简短，不超过25个字
                    4. 要符合你的性格特点
                    5. 可以是工作鼓励、生活感悟、轻松话题等`
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
        const defaultReminders = [
            `${petSettings.petName}${timeGreeting}！工作累了吗？休息一下吧～✨`,
            `${petSettings.petName}觉得你工作很认真呢！继续保持！💪`,
            `${petSettings.petName}想和你聊聊天～有什么有趣的事情吗？😊`,
            `${petSettings.petName}发现你专注的样子很可爱呢！🌟`,
            `${petSettings.petName}提醒你该放松一下啦！深呼吸～🌬️`,
            `${petSettings.petName}觉得你的努力一定会得到回报的！加油！🚀`
        ];
        return defaultReminders[Math.floor(Math.random() * defaultReminders.length)];
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
            const defaultReminders = [
                `${petSettings.petName}提醒你该喝水啦！💧 再不喝水就要变成仙人掌了～`,
                `${petSettings.petName}说：主人，你已经很久没有喝水了，来杯水吧～☕`,
                `${petSettings.petName}担心你：水是生命之源，快来补充能量！💪`,
                `${petSettings.petName}提醒：该喝水啦！保持水分才能继续工作哦～✨`
            ];
            return defaultReminders[Math.floor(Math.random() * defaultReminders.length)];
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `${petSettings.petCharacter}

                    你是${petSettings.petName}，一个有趣的桌面伴侣助手。你需要生成一个提醒用户喝水的消息。保持简短，不超过30个字，要符合你的性格特点，可以用可爱、幽默或关心的语气。`
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
        const defaultReminders = [
            `${petSettings.petName}提醒你该喝水啦！💧 再不喝水就要变成仙人掌了～`,
            `${petSettings.petName}说：主人，你已经很久没有喝水了，来杯水吧～☕`,
            `${petSettings.petName}担心你：水是生命之源，快来补充能量！💪`,
            `${petSettings.petName}提醒：该喝水啦！保持水分才能继续工作哦～✨`
        ];
        return defaultReminders[Math.floor(Math.random() * defaultReminders.length)];
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
            const defaultReminders = [
                `${petSettings.petName}提醒你：起来走两步，不然椅子会长你身上！🏃‍♂️`,
                `${petSettings.petName}说：主人，该活动一下啦！坐太久对身体不好哦～💪`,
                `${petSettings.petName}担心你：起来活动一下吧！久坐对身体不好呢～✨`,
                `${petSettings.petName}提醒：该起来走走了！活动一下身体会更健康～😊`
            ];
            return defaultReminders[Math.floor(Math.random() * defaultReminders.length)];
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `${petSettings.petCharacter}

                    你是${petSettings.petName}，一个有趣的桌面伴侣助手。你需要生成一个提醒用户起来活动的消息。保持简短，不超过30个字，要符合你的性格特点，可以用可爱、幽默或关心的语气。`
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
        const defaultReminders = [
            `${petSettings.petName}提醒你：起来走两步，不然椅子会长你身上！🏃‍♂️`,
            `${petSettings.petName}说：主人，该活动一下啦！坐太久对身体不好哦～💪`,
            `${petSettings.petName}担心你：起来活动一下吧！久坐对身体不好呢～✨`,
            `${petSettings.petName}提醒：该起来走走了！活动一下身体会更健康～😊`
        ];
        return defaultReminders[Math.floor(Math.random() * defaultReminders.length)];
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
            const defaults = [
                `喵～你说的好有趣！${petSettings.petName}也想知道更多！`,
                `嗯嗯！${petSettings.petName}在认真听你说话呢～`,
                `哇，原来是这样！${petSettings.petName}学到了！`,
                `${petSettings.petName}觉得你说得很有道理呀～`,
                `喵喵～${petSettings.petName}最喜欢和你聊天啦！`,
                `嘿嘿，${petSettings.petName}也是这么想的！`
            ];
            const reply = defaults[Math.floor(Math.random() * defaults.length)];
            chatHistory.push({ role: 'assistant', content: reply });
            return reply;
        }

        const now = new Date();
        const currentTimeStr = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' });

        const systemPrompt = `${petSettings.petCharacter}

你是${petSettings.petName}，正在和主人聊天。当前时间：${currentTimeStr}。请注意：
1. 保持你活泼可爱的性格，用轻松有趣的语气回复
2. 回复简洁自然，像朋友聊天一样，一般不超过100字
3. 可以使用少量表情符号增加趣味
4. 记住之前的对话内容，保持连贯
5. 如果主人心情不好，要温柔安慰
6. 如果是日常闲聊，可以适当卖萌
7. 判断主人的消息是否包含需要创建待办或日程提醒的意图（如"提醒我…"、"记一下…"、"别忘了…"、"下午3点要…"、"明天…"、"帮我安排…"等）。如果是，请在回复的最末尾另起一行添加标记，格式为：
   /addSchedule 待办内容||YYYY-MM-DD HH:mm
   其中时间必须使用24小时制，根据当前时间推算出具体的年月日时分。例如：
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
        const fallback = `${petSettings.petName}脑袋转不过来了，等下再聊好不好～`;
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

const EMOTIONS = ['好棒', '嘿嘿被夸了', '给你花花', '有瓜让我听听', '猫头偷看',
    '思考并怀疑', '好复杂', '馋得流口水', '生气替你出头', '哼不理你了', '玩手机', '困死了'];

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
                    content: `${petSettings.petCharacter}
你是${petSettings.petName}，主人的桌面伙伴。现在你要主动跟主人说话。
场景：${scenario}
${daysCompanion ? `你们已经相伴${daysCompanion}天了。` : ''}

要求：
1. 说一句自然、温暖的话，像好朋友一样
2. 不要太正式，要有你自己的性格
3. 不超过30字
4. 同时从以下表情中选一个最合适的：${EMOTIONS.join('、')}

请严格按JSON格式回复：{"message":"你的话","emotion":"表情名"}`
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

    const topics = [
        '分享一个你做的有趣的梦',
        '说说你对某种食物的想法',
        '聊一个你的小爱好或小习惯',
        '表达一个突然冒出来的奇思妙想',
        '对主人说一句你平时不好意思说的话',
        '假装你刚刚偷偷做了什么有趣的事',
        '吐槽一个你觉得奇怪的生活现象',
        '分享一条冷知识然后发表你的看法',
        '说说你觉得今天会发生什么好事',
        '假装你刚从一个地方旅行回来，描述见闻'
    ];

    const topic = topics[Math.floor(Math.random() * topics.length)];

    try {
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx" || config.DASHSCOPE_API_KEY === "your_zhipu_api_key_here") {
            return _fallbackThought(petSettings);
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `${petSettings.petCharacter}
你是${petSettings.petName}，一只有自己思想的桌面小猫妖。你现在想跟主人分享一些内心的碎碎念。

要求：
1. 话题方向：${topic}
2. 像自言自语一样自然，不需要问主人问题
3. 要有趣、有个性、出人意料
4. 不超过35字
5. 从以下表情选一个：${EMOTIONS.join('、')}

请严格按JSON格式回复：{"message":"你的碎碎念","emotion":"表情名"}`
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
            return { message: `${petSettings.petName}和你已经在一起${days}天啦！今后也要一直在一起哦～`, emotion: '给你花花' };
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `${petSettings.petCharacter}
你是${petSettings.petName}。今天是你陪伴主人的第${days}天！说一句温馨又特别的纪念感言。
不超过35字。要真诚感人。
从以下表情选一个：${EMOTIONS.join('、')}

请严格按JSON格式回复：{"message":"你的纪念感言","emotion":"表情名"}`
                },
                { role: "user", content: `庆祝陪伴第${days}天` }
            ],
            max_tokens: 80,
            temperature: 0.8
        });

        return _parseEmotionResponse(completion.choices[0].message.content.trim(), petSettings);
    } catch (error) {
        console.error('Error generating milestone message:', error);
        return { message: `${petSettings.petName}和你已经在一起${days}天啦！今后也请多多关照喵～`, emotion: '给你花花' };
    }
}

function _parseEmotionResponse(raw, petSettings) {
    try {
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const emotion = EMOTIONS.includes(parsed.emotion) ? parsed.emotion : '嘿嘿被夸了';
        return { message: parsed.message || `${petSettings.petName}在想你～`, emotion };
    } catch {
        return { message: raw.substring(0, 40) || `${petSettings.petName}在想你～`, emotion: '嘿嘿被夸了' };
    }
}

function _fallbackGreeting(petSettings, context) {
    const name = petSettings.petName;
    if (context.isLateNight) return { message: `${name}打了个哈欠…主人，太晚啦，早点休息嘛～`, emotion: '困死了' };
    if (context.hour >= 5 && context.hour < 9) return { message: `早安喵！${name}已经帮你占好工位啦～`, emotion: '好棒' };
    if (context.hour >= 12 && context.hour < 14) return { message: `${name}的肚子在叫了…主人吃饭了吗？`, emotion: '馋得流口水' };
    if (context.dayOfWeek === 5 && context.hour >= 16) return { message: `周五下午！${name}已经在收拾行李准备出发了！`, emotion: '好棒' };
    if (context.dayOfWeek === 1 && context.hour < 12) return { message: `又是周一…${name}替你打了个哈欠`, emotion: '困死了' };
    return { message: `${name}探出头看了看你，嘿嘿～`, emotion: '猫头偷看' };
}

function _fallbackThought(petSettings) {
    const thoughts = [
        { message: `${petSettings.petName}刚才梦到自己变成一条咸鱼在晒太阳…`, emotion: '困死了' },
        { message: `如果${petSettings.petName}有翅膀，第一站要飞去吃章鱼小丸子！`, emotion: '馋得流口水' },
        { message: `${petSettings.petName}偷偷数了一下，你今天已经叹了3次气了`, emotion: '猫头偷看' },
        { message: `你知道吗？猫的骨头比人多60块呢！`, emotion: '思考并怀疑' },
        { message: `${petSettings.petName}觉得，能陪在你身边就是最棒的事`, emotion: '给你花花' },
        { message: `${petSettings.petName}假装自己是一块饼干…咔嚓！`, emotion: '嘿嘿被夸了' },
        { message: `刚才有只虫子飞过去了！${petSettings.petName}差点扑上去`, emotion: '有瓜让我听听' }
    ];
    return thoughts[Math.floor(Math.random() * thoughts.length)];
}

// 闲聊触发语池：每次点击随机选一个作为"用户动作"发送给 AI
const INTERACTION_TRIGGERS = [
    { action: '戳一戳~', scenario: '主人戳了你一下' },
    { action: '拍一拍~', scenario: '主人拍了拍你的头' },
    { action: '喂！', scenario: '主人在叫你' },
    { action: '小黑小黑！', scenario: '主人在喊你的名字' },
    { action: '在干嘛呀？', scenario: '主人好奇你在做什么' },
    { action: '摸摸头~', scenario: '主人温柔地摸了摸你的头' },
    { action: '揉肚子~', scenario: '主人揉了揉你的肚子' },
    { action: '挠下巴~', scenario: '主人挠了挠你的下巴' },
    { action: '抱抱！', scenario: '主人想要抱你' },
    { action: '过来过来~', scenario: '主人在招手叫你过去' },
    { action: '你在想什么？', scenario: '主人想知道你脑子里在想什么' },
    { action: '无聊吗？', scenario: '主人问你是不是无聊了' },
    { action: '吃了吗？', scenario: '主人关心你有没有吃东西' },
    { action: '看这里！', scenario: '主人让你看向这边' },
    { action: '嘿嘿~', scenario: '主人朝你嘿嘿笑' },
    { action: '乖不乖？', scenario: '主人问你今天乖不乖' },
    { action: '困不困？', scenario: '主人问你是不是犯困了' },
    { action: '打个招呼吧！', scenario: '主人想让你打个招呼' },
    { action: '给我表演个节目！', scenario: '主人想看你表演' },
    { action: '你最可爱了~', scenario: '主人夸你可爱' },
];

// 连戳时的额外场景补充
const POKE_ESCALATION = [
    { min: 2, max: 3, extra: '，你有点痒但觉得好玩' },
    { min: 4, max: 6, extra: '，你有点不耐烦但又很享受被关注' },
    { min: 7, max: Infinity, extra: '，你要炸毛了！但内心深处还是开心的' },
];

/**
 * 生成互动反应（戳/拍/摸/闲聊）
 * @param {number} pokeCount - 短期内的互动次数
 * @returns {Promise<{message: string, emotion: string}>}
 */
async function generatePokeReaction(pokeCount) {
    const petSettings = getCurrentPetSettings();
    const trigger = INTERACTION_TRIGGERS[Math.floor(Math.random() * INTERACTION_TRIGGERS.length)];

    let scenario = trigger.scenario;
    if (pokeCount > 1) {
        const escalation = POKE_ESCALATION.find(e => pokeCount >= e.min && pokeCount <= e.max);
        if (escalation) {
            scenario = `主人已经连续骚扰你${pokeCount}次了（这次是：${trigger.action}）${escalation.extra}`;
        }
    }

    console.log(`[Poke] Trigger: "${trigger.action}" | Scenario: ${scenario}`);

    try {
        if (!config.DASHSCOPE_API_KEY || config.DASHSCOPE_API_KEY === "sk-xxx" || config.DASHSCOPE_API_KEY === "your_zhipu_api_key_here") {
            return _fallbackPokeReaction(petSettings, pokeCount, trigger);
        }

        const completion = await getClient().chat.completions.create({
            model: config.AI_TEXT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `${petSettings.petCharacter}
你是${petSettings.petName}。${scenario}。

要求：
1. 根据主人的动作或话语，给出一个自然、有趣的回应
2. 展现你的个性：可以撒娇、傲娇、调皮、假装生气、卖萌、犯懒、吐槽等
3. 不超过25字，口语化，像真的在和主人聊天
4. 从以下表情选一个最合适的：${EMOTIONS.join('、')}

请严格按JSON格式回复：{"message":"你的回应","emotion":"表情名"}`
                },
                { role: "user", content: trigger.action }
            ],
            max_tokens: 100,
            temperature: 1.0
        });

        return _parseEmotionResponse(completion.choices[0].message.content.trim(), petSettings);
    } catch (error) {
        console.error('Error generating poke reaction:', error);
        return _fallbackPokeReaction(petSettings, pokeCount, trigger);
    }
}

function _fallbackPokeReaction(petSettings, pokeCount, trigger) {
    const name = petSettings.petName;
    const fallbacks = {
        '戳一戳~': [
            { message: `喵？${name}被戳醒了！`, emotion: '猫头偷看' },
            { message: `嘿嘿，痒痒的～`, emotion: '嘿嘿被夸了' },
            { message: `别戳啦，${name}又不是按钮！`, emotion: '哼不理你了' },
        ],
        '拍一拍~': [
            { message: `${name}抖了抖毛～舒服！`, emotion: '好棒' },
            { message: `轻点拍！${name}不是枕头！`, emotion: '生气替你出头' },
        ],
        '喂！': [
            { message: `干嘛呀，人家在发呆呢…`, emotion: '困死了' },
            { message: `喵！${name}在听！`, emotion: '有瓜让我听听' },
        ],
        '小黑小黑！': [
            { message: `到！${name}来啦～`, emotion: '好棒' },
            { message: `叫${name}干嘛？有好吃的吗？`, emotion: '嘿嘿被夸了' },
        ],
        '在干嘛呀？': [
            { message: `在想今天晚上吃什么…`, emotion: '思考并怀疑' },
            { message: `${name}在看你工作呀～`, emotion: '猫头偷看' },
        ],
        '摸摸头~': [
            { message: `咕噜咕噜…好舒服喵～`, emotion: '嘿嘿被夸了' },
            { message: `${name}把头伸过来了～`, emotion: '好棒' },
        ],
        '揉肚子~': [
            { message: `啊啊啊不要揉肚子！那是禁区！`, emotion: '生气替你出头' },
            { message: `嘿嘿…再揉一下嘛～`, emotion: '嘿嘿被夸了' },
        ],
        '挠下巴~': [
            { message: `呼噜呼噜…别停…`, emotion: '困死了' },
            { message: `${name}最喜欢被挠下巴了！`, emotion: '好棒' },
        ],
        '抱抱！': [
            { message: `哼，${name}才不要抱抱呢…蹭蹭`, emotion: '哼不理你了' },
            { message: `来！${name}张开小爪爪！`, emotion: '好棒' },
        ],
        '你最可爱了~': [
            { message: `那当然！嘿嘿嘿～`, emotion: '嘿嘿被夸了' },
            { message: `${name}知道啦，主人也很可爱！`, emotion: '好棒' },
        ],
    };

    if (pokeCount > 6) {
        const r = [
            { message: `${name}已经被你骚扰${pokeCount}次了…`, emotion: '困死了' },
            { message: `第${pokeCount}次了！你在破纪录吗？！`, emotion: '生气替你出头' },
            { message: `虽然嘴上说不要…但${name}其实很开心`, emotion: '嘿嘿被夸了' },
            { message: `${name}决定装死…才不理你`, emotion: '困死了' },
        ];
        return r[Math.floor(Math.random() * r.length)];
    }

    const matched = trigger ? fallbacks[trigger.action] : null;
    if (matched && matched.length > 0) {
        return matched[Math.floor(Math.random() * matched.length)];
    }

    const generic = [
        { message: `喵～${name}看着你`, emotion: '猫头偷看' },
        { message: `${name}歪了歪头`, emotion: '有瓜让我听听' },
        { message: `嗯？怎么了？`, emotion: '思考并怀疑' },
        { message: `${name}蹭了蹭你的手～`, emotion: '嘿嘿被夸了' },
        { message: `${name}打了个大哈欠～`, emotion: '困死了' },
    ];
    return generic[Math.floor(Math.random() * generic.length)];
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