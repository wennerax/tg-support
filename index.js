require('dotenv').config();
const { token } = require('./config');
const { Telegraf } = require('telegraf');
const { session } = require('telegraf');
const setupMediaHandler = require('./mediaHandler');
const setupModeratorReplyHandler = require('./moderatorReplyHandler');
// const ImageProcessor = require('./imageProcessor');

if (!token) {
  console.error('Error: BOT_TOKEN not set. Create a .env file or set BOT_TOKEN env var.');
  process.exit(1);
}

const bot = new Telegraf(token);

// Setup session middleware for tracking active reply sessions
bot.use(session());
// Note: use Telegram's copyMessage/sendDocument/sendSticker directly

const rawModerationChatId = "-1003691307198";
const MODERATION_CHAT_ID = normalizeChatId(rawModerationChatId);
const MODERATION_CHAT_ID_NUM = Number(MODERATION_CHAT_ID);

function normalizeChatId(id) {
  const idStr = id.toString();
  if (idStr.startsWith('-100')) return idStr;
  if (idStr.startsWith('-')) return idStr;
  return `-100${idStr}`;
}

const blockedUsers = new Set();
const questionMap = new Map(); // messageId -> {userId, username}
const replySessions = new Map(); // from.id -> questionMessageId
const { setupBanCommands } = require('./bans');

// Создаем inline-клавиатуру для ответов
function createReplyKeyboard(messageId) {
  return {
    inline_keyboard: [
      [
        { text: '💬 Ответить', callback_data: `reply_${messageId}` },
        { text: '✖️ Отклонить', callback_data: `cancel_${messageId}` }
      ],
      [
        { text: '🗑️ Удалить', callback_data: `disband_${messageId}` }
      ]
    ]
  };
}

// Setup media forwarding handler
setupMediaHandler(bot, MODERATION_CHAT_ID, questionMap, blockedUsers, createReplyKeyboard);

// Setup moderator reply handler (removes button on click and detects response)
setupModeratorReplyHandler(bot, MODERATION_CHAT_ID, questionMap, createReplyKeyboard);

// Старт
bot.start((ctx) => {
  ctx.reply(`✨ *Это — поддержка беседы "БРЕДИМ"* ✨

📝 Здесь ты можешь задать свой вопрос, а наши модераторы ответят в кратчайшие сроки.

🌟 *Просто напиши свой вопрос, и мы обязательно свяжемся с тобой!*

📩 *Жду твоего сообщения!*`, { parse_mode: 'Markdown' });
});

// Register ban command handlers from bans.js (persists to bannedUsers.json)
setupBanCommands(bot, MODERATION_CHAT_ID_NUM, blockedUsers);
// /sendsticker
bot.command('sendsticker', async (ctx) => {
  if (ctx.chat.id !== parseInt(MODERATION_CHAT_ID)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) {
    return ctx.reply('Используйте: /sendsticker <userId> <stickerFileId>');
  }
  const userId = args[0];
  const stickerFileId = args.slice(1).join(' ');
  try {
    await ctx.telegram.sendSticker(userId, stickerFileId);
    ctx.reply(`Стикер отправлен пользователю ${userId}`);
  } catch (err) {
    console.error('Ошибка при отправке стикера:', err);
    ctx.reply('Не удалось отправить стикер пользователю.');
  }
});

// Обработка сообщений от пользователей
bot.on('message', async (ctx) => {
  const chatId = ctx.chat.id;
  const from = ctx.message.from;
  const userId = from.id.toString();

  if (chatId === parseInt(MODERATION_CHAT_ID)) {
    // Проверяем активный сеанс ответа
    ctx.session = ctx.session || {};
    if (ctx.session.activeReplySession) {
      const { messageId, userId: targetUserId, username } = ctx.session.activeReplySession;
      
      try {
        await ctx.telegram.sendMessage(targetUserId, `📝 *Ответ от модератора:*\n${ctx.message.text}`, { parse_mode: 'Markdown' });
        ctx.reply(`Ответ отправлен пользователю ${targetUserId} (${username})`);
        
        // Clear the active reply session and delete the original question message
        ctx.session.activeReplySession = null;
        questionMap.delete(messageId);
        
        try {
          await ctx.telegram.deleteMessage(MODERATION_CHAT_ID, messageId);
        } catch (err) {
          // Message might have been already deleted
          console.error('Could not delete message:', err);
        }
      } catch (err) {
        console.error('Ошибка при отправке сообщения пользователю:', err);
        ctx.reply('Не удалось отправить сообщение пользователю.');
      }
      return;
    }

    // Обычная проверка reply-to-message для старого режима
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (!replyMsgId || !questionMap.has(replyMsgId)) {
      await ctx.reply('Пожалуйста, используйте кнопку "Ответить" на сообщении с вопросом, или отвечайте на сообщение, содержащее вопрос, используя reply.');
      return;
    }
    const { userId: targetUserId, username } = questionMap.get(replyMsgId);
    try {
      await ctx.telegram.sendMessage(targetUserId, `📝 *Ответ от модератора:*\n${ctx.message.text}`, { parse_mode: 'Markdown' });
      ctx.reply(`Ответ отправлен пользователю ${targetUserId} (${username})`);
    } catch (err) {
      console.error('Ошибка при отправке сообщения пользователю:', err);
      ctx.reply('Не удалось отправить сообщение пользователю.');
    }
    return;
  }

  // Пользовательский вопрос
  if (blockedUsers.has(userId)) return;

  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    const username = from.username ? `@${from.username}` : '(без username)';
    const questionText = `❓ *Вопрос от пользователя ${userId} ${username}:*\n${ctx.message.text}`;
    try {
      const sentMsg = await ctx.telegram.sendMessage(MODERATION_CHAT_ID, questionText, { parse_mode: 'Markdown' });
      questionMap.set(sentMsg.message_id, { userId, username });
      await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, sentMsg.message_id, undefined, createReplyKeyboard(sentMsg.message_id));
      ctx.reply('Ваш вопрос отправлен модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при отправке вопроса:', err);
      ctx.reply('Произошла ошибка при отправке вопроса.');
    }
  }
});

// Reply and reject button handlers are in moderatorReplyHandler.js

// Обработка кнопки "Отклонить"
bot.action(/^cancel_(\d+)$/, async (ctx) => {
  const messageId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  if (chatId !== MODERATION_CHAT_ID_NUM) {
    await ctx.answerCbQuery('Только модераторы могут отклонять.', true);
    return;
  }
  if (!questionMap.has(messageId)) {
    await ctx.answerCbQuery('Вопрос уже обработан или не найден.', true);
    return;
  }
  
  const { userId, username } = questionMap.get(messageId);
  questionMap.delete(messageId);
  
  try {
    // Send rejection message to the user
    await ctx.telegram.sendMessage(userId, '❌ *К сожалению, ваш вопрос был отклонен.*\n\nПожалуйста, свяжитесь с администрацией, если у вас есть вопросы.', { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Ошибка при отправке уведомления об отклонении:', err);
  }
  
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.answerCbQuery('Вопрос отклонен.');
});

// Обработка кнопки "Заблокировать"
bot.action(/^ban_(\d+)$/, async (ctx) => {
  const messageId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  if (chatId !== MODERATION_CHAT_ID_NUM) {
    await ctx.answerCbQuery('Только модераторы могут блокировать.', true);
    return;
  }
  if (!questionMap.has(messageId)) {
    await ctx.answerCbQuery('Вопрос уже обработан или не найден.', true);
    return;
  }

  const { userId, username } = questionMap.get(messageId);
  blockedUsers.add(userId);
  questionMap.delete(messageId);

  try {
    await ctx.telegram.sendMessage(userId, '⛔ *Вам отказано в поддержке. Ваши вопросы больше не принимаются.*', { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Не удалось уведомить пользователя о блокировке:', err);
  }

  try {
    await ctx.telegram.deleteMessage(MODERATION_CHAT_ID, messageId);
  } catch (err) {
    console.error('Could not delete message after ban:', err);
  }

  await ctx.editMessageReplyMarkup(undefined);
  await ctx.answerCbQuery(`Пользователь ${username || userId} заблокирован.`);
});

// Обработка кнопки "Disband" (удалить/отклонить без уведомления)
bot.action(/^disband_(\d+)$/, async (ctx) => {
  const messageId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  if (chatId !== MODERATION_CHAT_ID_NUM) {
    await ctx.answerCbQuery('Только модераторы могут удалять вопросы.', true);
    return;
  }
  if (!questionMap.has(messageId)) {
    await ctx.answerCbQuery('Вопрос уже обработан или не найден.', true);
    return;
  }

  const { userId, username } = questionMap.get(messageId);
  questionMap.delete(messageId);

  try {
    await ctx.telegram.deleteMessage(MODERATION_CHAT_ID, messageId);
  } catch (err) {
    console.error('Could not delete message on disband:', err);
  }

  await ctx.editMessageReplyMarkup(undefined);
  await ctx.answerCbQuery(`Вопрос от ${username || userId} удалён.`);
});

// Запуск сервера
const express = require('express');
const app = express();
const port = Math.floor(Math.random() * (9000 - 2000 + 1)) + 2000;

app.get('/', (req, res) => res.send('Бот запущен!'));

function run() {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}

function keepAlive() {
  run();
}

// Перезапуск при необходимости
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  console.log('Перезапускаем бота...');
  bot.launch().catch(console.error);
});

setInterval(() => {
  bot.telegram.getMe()
    .then(() => console.log('Бот работает корректно'))
    .catch(() => {
      console.log('Перезапускаем бота...');
      bot.launch().catch(console.error);
    });
}, 3600000);

keepAlive();
bot.launch().then(() => console.log('Бот запущен!')).catch(console.error);
