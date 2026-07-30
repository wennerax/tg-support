require('dotenv').config();
const { token } = require('./config');
const { Telegraf, session } = require('telegraf');
const setupMediaHandler = require('./mediaHandler');
const { setupBanCommands } = require('./bans');
const setupAdminBroadcast = require('./adminBroadcast');
const { isTextQuestionMessage } = require('./messageUtils');

if (!token) {
  console.error('Error: BOT_TOKEN not set. Create a .env file or set BOT_TOKEN env var.');
  process.exit(1);
}

const bot = new Telegraf(token);
bot.use(session());

const rawModerationChatId = process.env.MODERATION_CHAT_ID || '-1003691307198';
const MODERATION_CHAT_ID = normalizeChatId(rawModerationChatId);
const MODERATION_CHAT_ID_NUM = Number(MODERATION_CHAT_ID);

function normalizeChatId(id) {
  const idStr = String(id).trim();
  if (idStr.startsWith('-100')) return idStr;
  if (idStr.startsWith('-')) return idStr;
  return `-100${idStr}`;
}

const blockedUsers = new Set();
const questionMap = new Map();
const chatIds = new Set([MODERATION_CHAT_ID_NUM]);
const adminUserId = process.env.ADMIN_USER_ID || '7288555779';

function createReplyKeyboard(messageId) {
  return {
    inline_keyboard: [
      [{ text: '✖️ Отклонить', callback_data: `cancel_${messageId}` }]
    ]
  };
}

setupMediaHandler(bot, MODERATION_CHAT_ID, questionMap, blockedUsers, createReplyKeyboard);
setupBanCommands(bot, MODERATION_CHAT_ID_NUM, blockedUsers);
setupAdminBroadcast(bot, chatIds, adminUserId);

bot.start((ctx) => {
  ctx.reply(`✨ *Это — поддержка беседы "БРЕДИМ"* ✨

📝 Здесь ты можешь задать свой вопрос, а наши модераторы ответят в кратчайшие сроки.

🌟 *Просто напиши свой вопрос, и мы обязательно свяжемся с тобой!*

📩 *Жду твоего сообщения!*`, { parse_mode: 'Markdown' });
});

bot.command('sendsticker', async (ctx) => {
  if (ctx.chat.id !== MODERATION_CHAT_ID_NUM) return;
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

bot.on('message', async (ctx) => {
  const chatId = ctx.chat?.id;
  const from = ctx.message?.from;
  if (!chatId || !from) return;

  if (chatId !== MODERATION_CHAT_ID_NUM) {
    chatIds.add(chatId);
  }

  const userId = String(from.id);

  if (chatId === MODERATION_CHAT_ID_NUM) {
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (!replyMsgId || !questionMap.has(replyMsgId)) {
      await ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
      return;
    }

    const { userId: targetUserId, username } = questionMap.get(replyMsgId);
    const answerText = ctx.message.text || ctx.message.caption || '';
    if (!answerText.trim()) {
      await ctx.reply('Пожалуйста, отправьте текстовый ответ.');
      return;
    }

    try {
      await ctx.telegram.sendMessage(targetUserId, `📝 Ответ от модератора:\n${answerText}`);
      await ctx.reply(`Ответ отправлен пользователю ${targetUserId} (${username})`);
      questionMap.delete(replyMsgId);
      try {
        await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, replyMsgId, undefined, undefined);
      } catch (err) {
        console.error('Could not edit moderation message after reply:', err);
      }
    } catch (err) {
      console.error('Ошибка при отправке сообщения пользователю:', err);
      ctx.reply('Не удалось отправить сообщение пользователю.');
    }
    return;
  }

  if (blockedUsers.has(userId)) return;
  if (!isTextQuestionMessage(ctx.message)) return;

  const username = from.username ? `@${from.username}` : '(без username)';
  const questionText = `❓ Вопрос от пользователя <code>${userId}</code> ${username}:\n${ctx.message.text}`;
  try {
    const sentMsg = await ctx.telegram.sendMessage(MODERATION_CHAT_ID, questionText, { parse_mode: 'HTML' });
    questionMap.set(sentMsg.message_id, { userId, username });
    await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, sentMsg.message_id, undefined, createReplyKeyboard(sentMsg.message_id));
    ctx.reply('Ваш вопрос отправлен модераторам. Ожидайте ответа.');
  } catch (err) {
    console.error('Ошибка при отправке вопроса:', err);
    ctx.reply('Произошла ошибка при отправке вопроса.');
  }
});

bot.action(/^cancel_(\d+)$/, async (ctx) => {
  const messageId = Number.parseInt(ctx.match[1], 10);
  if (ctx.chat?.id !== MODERATION_CHAT_ID_NUM) {
    await ctx.answerCbQuery('Только модераторы могут отклонять.', true);
    return;
  }
  if (!questionMap.has(messageId)) {
    await ctx.answerCbQuery('Вопрос уже обработан или не найден.', true);
    return;
  }

  const { userId } = questionMap.get(messageId);
  questionMap.delete(messageId);

  try {
    await ctx.telegram.sendMessage(userId, '❌ *К сожалению, ваш вопрос был отклонен.*\n\nПожалуйста, свяжитесь с администрацией, если у вас есть вопросы.', { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Ошибка при отправке уведомления об отклонении:', err);
  }

  await ctx.editMessageReplyMarkup(undefined);
  await ctx.answerCbQuery('Вопрос отклонен.');
});

const express = require('express');
const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.get('/', (req, res) => res.send('Бот запущен!'));

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});

bot.launch()
  .then(() => console.log('Бот запущен!'))
  .catch((err) => {
    console.error('Ошибка запуска бота:', err);
    process.exit(1);
  });

process.once('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
