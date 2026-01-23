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

// Старт
bot.start((ctx) => {
  ctx.reply(`✨ *Это — поддержка беседы "......."* ✨

📝 Здесь ты можешь задать свой вопрос, а наши модераторы ответят в кратчайшие сроки.

🌟 *Просто напиши свой вопрос, и мы обязательно свяжемся с тобой!*

📩 *Жду твоего сообщения!*`, { parse_mode: 'Markdown' });
});

// /ban
bot.command('ban', async (ctx) => {
  if (ctx.chat.id !== parseInt(MODERATION_CHAT_ID)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) return ctx.reply('Используйте /ban @username или /ban user_id');

  let userIdentifier = args[0];
  let userIdToBan;

  if (userIdentifier.startsWith('@')) {
    try {
      const chatMember = await ctx.telegram.getChatMember(MODERATION_CHAT_ID, userIdentifier);
      userIdToBan = chatMember.user.id.toString();
    } catch {
      return ctx.reply('Не удалось найти пользователя с таким username.');
    }
  } else {
    const idNum = parseInt(userIdentifier, 10);
    if (isNaN(idNum)) return ctx.reply('Некорректный user_id.');
    userIdToBan = idNum.toString();
  }

  blockedUsers.add(userIdToBan);
  ctx.reply(`Пользователь ${userIdentifier} заблокирован.`);
});

// /unban
bot.command('unban', async (ctx) => {
  if (ctx.chat.id !== parseInt(MODERATION_CHAT_ID)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) return ctx.reply('Используйте /unban @username или /unban user_id');

  let userIdentifier = args[0];
  let userIdToUnban;

  if (userIdentifier.startsWith('@')) {
    try {
      const chatMember = await ctx.telegram.getChatMember(MODERATION_CHAT_ID, userIdentifier);
      userIdToUnban = chatMember.user.id.toString();
    } catch {
      return ctx.reply('Не удалось найти пользователя с таким username.');
    }
  } else {
    const idNum = parseInt(userIdentifier, 10);
    if (isNaN(idNum)) return ctx.reply('Некорректный user_id.');
    userIdToUnban = idNum.toString();
  }

  if (blockedUsers.has(userIdToUnban)) {
    blockedUsers.delete(userIdToUnban);
    ctx.reply(`Пользователь ${userIdentifier} разблокирован.`);
  } else {
    ctx.reply('Этот пользователь не заблокирован.');
  }
});

// /sendimage
bot.command('sendimage', async (ctx) => {
  if (ctx.chat.id !== parseInt(MODERATION_CHAT_ID)) return;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) {
    return ctx.reply('Используйте: /sendimage <userId> <imageUrl или fileId>');
  }
  const userId = args[0];
  const imageSource = args.slice(1).join(' ');
  try {
    await imageProcessor.sendFormattedImage(userId, imageSource, { caption: '', formatAsAnswer: true });
    ctx.reply(`Изображение отправлено пользователю ${userId}`);
  } catch (err) {
    console.error('Ошибка при отправке изображения:', err);
    ctx.reply('Не удалось отправить изображение пользователю.');
  }
});

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
    await imageProcessor.sendSticker(userId, stickerFileId);
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
    // Ответ модератора
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (!replyMsgId || !questionMap.has(replyMsgId)) {
      await ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
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

// Обработка фото, стикеров, анимаций
bot.on(['photo', 'sticker', 'animation'], async (ctx) => {
  const chatId = ctx.chat.id;

  if (chatId === parseInt(MODERATION_CHAT_ID)) {
    // Ответ модератора
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (!replyMsgId || !questionMap.has(replyMsgId)) {
      await ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
      return;
    }
    const { userId, username } = questionMap.get(replyMsgId);
    try {
      if (ctx.message.photo) {
        const fileId = getFileIdFromMessage(ctx.message);
        await imageProcessor.sendImage(userId, fileId, '📝 *Ответ от модератора*');
      } else if (ctx.message.sticker) {
        await imageProcessor.sendSticker(userId, ctx.message.sticker.file_id);
      } else if (ctx.message.animation) {
        await ctx.telegram.sendAnimation(userId, ctx.message.animation.file_id, { caption: '📝 *Ответ от модератора*', parse_mode: 'Markdown' });
      }
      await ctx.reply(`Медиа отправлены пользователю ${userId} (${username})`);
    } catch (err) {
      console.error('Ошибка при отправке медиа:', err);
      await ctx.reply('Не удалось отправить медиа пользователю.');
    }
    return;
  }

  // От пользователя
  if (blockedUsers.has(userId)) return;

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
    }
    if (sentMsg) {
      questionMap.set(sentMsg.message_id, { userId, username: from.username || '(без username)' });
      await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, sentMsg.message_id, undefined, createReplyKeyboard(sentMsg.message_id));
    }
    ctx.reply('Ваше медиа отправлено модераторам. Ожидайте ответа.');
  } catch (err) {
    console.error('Ошибка при отправке медиа:', err);
    ctx.reply('Произошла ошибка при отправке медиа.');
  }
});

// Вспомогательная функция для получения file_id из сообщения
function getFileIdFromMessage(msg) {
  if (msg.photo) {
    return msg.photo[msg.photo.length - 1].file_id;
  }
  return null;
}

// Обработка виде, документов, аудио, голосовых
bot.on(['video', 'document', 'audio', 'voice'], async (ctx) => {
  const chatId = ctx.chat.id;
  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    try {
      await ctx.telegram.copyMessage(MODERATION_CHAT_ID, chatId, ctx.message.message_id);
    } catch (err) {
      console.error('Ошибка пересылки мультимедиа:', err);
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

// Обработка текстовых сообщений (ответ модератора)
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
