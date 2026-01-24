require('dotenv').config();
const { token } = require('./config');
const { Telegraf } = require('telegraf');
const ImageProcessor = require('./imageProcessor');

if (!token) {
  console.error('Error: BOT_TOKEN not set. Create a .env file or set BOT_TOKEN env var.');
  process.exit(1);
}

const bot = new Telegraf(token);
const imageProcessor = new ImageProcessor(bot.telegram);

const rawModerationChatId = "-1003691307198";
const MODERATION_CHAT_ID = normalizeChatId(rawModerationChatId);

function normalizeChatId(id) {
  const idStr = id.toString();
  if (idStr.startsWith('-100')) return idStr;
  if (idStr.startsWith('-')) return idStr;
  return `-100${idStr}`;
}

const blockedUsers = new Set();
const questionMap = new Map(); // messageId -> {userId, username}
const replySessions = new Map(); // from.id -> questionMessageId

// Создаем inline-клавиатуру для ответов
function createReplyKeyboard(messageId) {
  return {
    inline_keyboard: [
      [
        { text: '💬 Ответить', callback_data: `reply_${messageId}` },
        { text: '✖️ Отклонить', callback_data: `cancel_${messageId}` }
      ]
    ]
  };
}

// Вспомогательная функция для получения file_id из сообщения
function getFileIdFromMessage(msg) {
  if (msg.photo) {
    // Выбирается последний (самый большой)
    return msg.photo[msg.photo.length - 1].file_id;
  }
  if (msg.sticker) {
    return msg.sticker.file_id;
  }
  if (msg.animation) {
    return msg.animation.file_id;
  }
  return null;
}

// Обработка сообщений от пользователей (включая медиа)
bot.on(['message'], async (ctx) => {
  const chatId = ctx.chat.id;
  const from = ctx.message.from;
  const userId = from.id.toString();

  // Обработка мультимедиа (фото, стикеры, гифки, видео, аудио, голосовые, документы)
  if (['photo', 'sticker', 'animation', 'video', 'audio', 'voice', 'document'].includes(ctx.message.document ? 'document' : ctx.message.video ? 'video' : ctx.message.photo ? 'photo' : ctx.message.sticker ? 'sticker' : ctx.message.animation ? 'animation' : ctx.message.audio ? 'audio' : ctx.message.voice ? 'voice' : '')) {
    // Если сообщение из модерационной группы
    if (chatId === parseInt(MODERATION_CHAT_ID)) {
      const replyMsgId = ctx.message.reply_to_message?.message_id;
      if (!replyMsgId || !questionMap.has(replyMsgId)) {
        await ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
        return;
      }
      const { userId: targetUserId, username } = questionMap.get(replyMsgId);
      try {
        if (ctx.message.photo) {
          const fileId = getFileIdFromMessage(ctx.message);
          await imageProcessor.sendImage(targetUserId, fileId, '📝 *Ответ от модератора*');
        } else if (ctx.message.sticker) {
          await imageProcessor.sendSticker(targetUserId, ctx.message.sticker.file_id);
        } else if (ctx.message.animation) {
          await ctx.telegram.sendAnimation(targetUserId, ctx.message.animation.file_id, { caption: '📝 *Ответ от модератора*', parse_mode: 'Markdown' });
        } else if (ctx.message.video) {
          await ctx.telegram.sendVideo(targetUserId, ctx.message.video.file_id, { caption: '📝 *Ответ от модератора*', parse_mode: 'Markdown' });
        } else if (ctx.message.audio) {
          await ctx.telegram.sendAudio(targetUserId, ctx.message.audio.file_id, { caption: '📝 *Ответ от модератора*', parse_mode: 'Markdown' });
        } else if (ctx.message.voice) {
          await ctx.telegram.sendVoice(targetUserId, ctx.message.voice.file_id, { caption: '📝 *Ответ от модератора*', parse_mode: 'Markdown' });
        } else if (ctx.message.document) {
          await ctx.telegram.sendDocument(targetUserId, ctx.message.document.file_id, { caption: '📝 *Ответ от модератора*', parse_mode: 'Markdown' });
        }
        await ctx.reply(`Медиа отправлены пользователю ${targetUserId} (${username})`);
      } catch (err) {
        console.error('Ошибка при отправке медиа:', err);
        await ctx.reply('Не удалось отправить медиа пользователю.');
      }
      return;
    }

    // От пользователя — пересылаем в модерацию
    if (blockedUsers.has(userId)) return; // Игнорируем заблокированных

    let headerText = `❓ *Вопрос от пользователя ${userId}*`;

    try {
      let sentMsg;
      if (ctx.message.photo) {
        const fileId = getFileIdFromMessage(ctx.message);
        const caption = ctx.message.caption ? `${headerText}\n${ctx.message.caption}` : headerText;
        sentMsg = await ctx.telegram.sendPhoto(MODERATION_CHAT_ID, fileId, { caption, parse_mode: 'Markdown' });
      } else if (ctx.message.sticker) {
        sentMsg = await ctx.telegram.sendSticker(MODERATION_CHAT_ID, ctx.message.sticker.file_id);
      } else if (ctx.message.animation) {
        const caption = ctx.message.caption ? `${headerText}\n${ctx.message.caption}` : headerText;
        sentMsg = await ctx.telegram.sendAnimation(MODERATION_CHAT_ID, ctx.message.animation.file_id, { caption, parse_mode: 'Markdown' });
      } else if (ctx.message.video) {
        sentMsg = await ctx.telegram.sendVideo(MODERATION_CHAT_ID, ctx.message.video.file_id, { caption: headerText, parse_mode: 'Markdown' });
      } else if (ctx.message.audio) {
        sentMsg = await ctx.telegram.sendAudio(MODERATION_CHAT_ID, ctx.message.audio.file_id, { caption: headerText, parse_mode: 'Markdown' });
      } else if (ctx.message.voice) {
        sentMsg = await ctx.telegram.sendVoice(MODERATION_CHAT_ID, ctx.message.voice.file_id, { caption: headerText, parse_mode: 'Markdown' });
      } else if (ctx.message.document) {
        sentMsg = await ctx.telegram.sendDocument(MODERATION_CHAT_ID, ctx.message.document.file_id, { caption: headerText, parse_mode: 'Markdown' });
      }

      if (sentMsg) {
        questionMap.set(sentMsg.message_id, { userId, username: from.username || '(без username)' });
        await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, sentMsg.message_id, undefined, createReplyKeyboard(sentMsg.message_id));
        ctx.reply('Ваш вопрос отправлен модераторам. Ожидайте ответа.');
      }
    } catch (err) {
      console.error('Ошибка при отправке вопроса:', err);
      ctx.reply('Произошла ошибка при отправке вопроса.');
    }
    return;
  }

  // Обычные текстовые сообщения (не мультимедиа)
  if (blockedUsers.has(userId)) return;

  // Пользовательский вопрос
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

// Обработка кнопок "Ответить" и "Отклонить"
bot.action(/^reply_(\d+)$/, async (ctx) => {
  const messageId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    await ctx.answerCbQuery('Только модераторы могут отвечать.', true);
    return;
  }
  if (!questionMap.has(messageId)) {
    await ctx.answerCbQuery('Вопрос больше не найден.', true);
    return;
  }
  replySessions.set(ctx.from.id, messageId);
  await ctx.answerCbQuery('Теперь напишите ответ и отправьте его.');
  ctx.reply('Напишите ваш ответ. После этого он будет отправлен пользователю.');
});

bot.action(/^cancel_(\d+)$/, async (ctx) => {
  const messageId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    await ctx.answerCbQuery('Только модераторы могут отклонять.', true);
    return;
  }
  if (!questionMap.has(messageId)) {
    await ctx.answerCbQuery('Вопрос уже обработан или не найден.', true);
    return;
  }
  questionMap.delete(messageId);
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.answerCbQuery('Вопрос отклонен.');
});

// Обработка текста — ответ модератора
bot.on('text', async (ctx) => {
  const fromId = ctx.from.id;
  if (!replySessions.has(fromId)) return;
  const questionMsgId = replySessions.get(fromId);
  replySessions.delete(fromId);
  if (!questionMap.has(questionMsgId)) {
    ctx.reply('Вопрос уже обработан или не найден.');
    return;
  }
  const { userId, username } = questionMap.get(questionMsgId);
  try {
    await ctx.telegram.sendMessage(userId, `📝 *Ответ от модератора:*\n${ctx.message.text}`, { parse_mode: 'Markdown' });
    ctx.reply(`Ответ отправлен пользователю ${userId} (${username})`);
  } catch (err) {
    console.error('Ошибка при отправке ответа:', err);
    ctx.reply('Не удалось отправить ответ пользователю.');
  }
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
