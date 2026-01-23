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

const rawModerationChatId = "-1002485675560";
const MODERATION_CHAT_ID = normalizeChatId(rawModerationChatId);

function normalizeChatId(id) {
  const idStr = id.toString();
  if (idStr.startsWith('-100')) {
    return idStr;
  }
  if (idStr.startsWith('-')) {
    return idStr;
  }
  return `-100${idStr}`;
}

const blockedUsers = new Set();
const questionMap = new Map();
const replySessions = new Map();

// Helper function для создания reply-клавиатуры
function createReplyKeyboard(messageId) {
  return {
    inline_keyboard: [
      [
        {
          text: '💬 Ответить',
          callback_data: `reply_${messageId}`
        },
        {
          text: '✖️ Отклонить',
          callback_data: `cancel_${messageId}`
        }
      ]
    ]
  };
}

bot.start((ctx) => {
  ctx.reply(`
✨ *Это — поддержка беседы "......."* ✨

📝 Здесь ты можешь задать свой вопрос, а наши модераторы ответят в кратчайшие сроки.

🌟 *Просто напиши свой вопрос, и мы обязательно свяжемся с тобой!*

📩 *Жду твоего сообщения!*`, { parse_mode: 'Markdown' });
});

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
  ctx.reply(`Пользователь ${userIdentifier} заблокирован. Он больше не сможет задавать вопросы.`);
});

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
    ctx.reply(`Пользователь ${userIdentifier} разблокирован. Теперь он сможет задавать вопросы.`);
  } else {
    ctx.reply('Этот пользователь не заблокирован.');
  }
});

bot.command('sendimage', async (ctx) => {
  if (ctx.chat.id !== parseInt(MODERATION_CHAT_ID)) return;

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) {
    return ctx.reply('Используйте: /sendimage <userId> <imageUrl или fileId>');
  }

  const userId = args[0];
  const imageSource = args.slice(1).join(' ');

  try {
    await imageProcessor.sendFormattedImage(userId, imageSource, {
      caption: '',
      formatAsAnswer: true
    });
    ctx.reply(`Изображение отправлено пользователю ${userId}`);
  } catch (err) {
    console.error('Ошибка при отправке изображения:', err);
    ctx.reply('Не удалось отправить изображение пользователю.');
  }
});

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

// Обработчик текстовых сообщений
bot.on('message', async (ctx) => {
  const chatId = ctx.chat.id;

  // Если это сообщение от модератора в модерационном чате
  if (chatId === parseInt(MODERATION_CHAT_ID)) {
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (!replyMsgId || !questionMap.has(replyMsgId)) {
      await ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
      return;
    }

    const { userId, username } = questionMap.get(replyMsgId);
    console.log(`Отправляем ответ пользователю ${userId} (${username})`);

    try {
      await ctx.telegram.sendMessage(userId, `📝 *Ответ от модератора:*\n${ctx.message.text}`, { parse_mode: 'Markdown' });
      ctx.reply(`Ответ отправлен пользователю ${userId} ${username}`);
    } catch (err) {
      console.error('Ошибка при отправке сообщения пользователю:', err);
      ctx.reply('Не удалось отправить сообщение пользователю. Возможно, он заблокировал бота или не начал чат.');
    }
    return;
  }

  // Если это сообщение от обычного пользователя
  const from = ctx.message.from;
  const userId = from.id.toString();
  
  if (blockedUsers.has(userId)) {
    return;
  }

  // Отправка вопроса модераторам
  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    const username = from.username ? `@${from.username}` : '(без username)';
    const questionText = `❓ *Вопрос от пользователя ${userId} ${username}:*\n${ctx.message.text}`;

    try {
      const sentMsg = await ctx.telegram.sendMessage(MODERATION_CHAT_ID, questionText, {
        parse_mode: 'Markdown'
      });
      questionMap.set(sentMsg.message_id, { userId, username });
      
      // Добавляем кнопки к сообщению
      await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, sentMsg.message_id, undefined, createReplyKeyboard(sentMsg.message_id));
      
      ctx.reply('Ваш вопрос отправлен модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при отправке вопроса:', err);
      ctx.reply('Произошла ошибка при отправке вопроса.');
    }
  }
});

// Обработка фото, стикеров и анимаций от пользователей
bot.on(['photo', 'sticker', 'animation'], async (ctx) => {
  const chatId = ctx.chat.id;

  // Если это ответ модератора на вопрос пользователя
  if (chatId === parseInt(MODERATION_CHAT_ID)) {
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (!replyMsgId || !questionMap.has(replyMsgId)) {
      await ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
      return;
    }

    const { userId, username } = questionMap.get(replyMsgId);
    console.log(`Отправляем медиа ответ пользователю ${userId} (${username})`);

    try {
      if (ctx.message.photo) {
        const photoFileId = imageProcessor.getFileIdFromMessage(ctx.message);
        const caption = ctx.message.caption ? `📝 *Ответ от модератора:*\n${ctx.message.caption}` : '📝 *Ответ от модератора*';
        await imageProcessor.sendImage(userId, photoFileId, caption);
      } else if (ctx.message.sticker) {
        const stickerFileId = ctx.message.sticker.file_id;
        await imageProcessor.sendSticker(userId, stickerFileId);
      } else if (ctx.message.animation) {
        const caption = ctx.message.caption ? `📝 *Ответ от модератора:*\n${ctx.message.caption}` : '📝 *Ответ от модератора*';
        await ctx.telegram.sendAnimation(userId, ctx.message.animation.file_id, { caption, parse_mode: 'Markdown' });
      }
      await ctx.reply(`Медиа отправлены пользователю ${userId} ${username}`);
    } catch (err) {
      console.error('Ошибка при отправке медиа пользователю:', err);
      await ctx.reply('Не удалось отправить медиа пользователю. Возможно, он заблокировал бота или не начал чат.');
    }
    return;
  }

  // Если это сообщение от пользователя в чате с ботом
  const from = ctx.message.from;
  const userId = from.id.toString();
  
  if (blockedUsers.has(userId)) {
    return;
  }

  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    const username = from.username ? `@${from.username}` : '(без username)';
    let headerText = `❓ *Вопрос от пользователя ${userId} ${username}:*`;
    
    try {
      let sentMsg;
      
      if (ctx.message.photo) {
        const photoFileId = imageProcessor.getFileIdFromMessage(ctx.message);
        const caption = ctx.message.caption ? `${headerText}\n${ctx.message.caption}` : headerText;
        sentMsg = await ctx.telegram.sendPhoto(MODERATION_CHAT_ID, photoFileId, {
          caption,
          parse_mode: 'Markdown'
        });
      } else if (ctx.message.sticker) {
        sentMsg = await ctx.telegram.sendSticker(MODERATION_CHAT_ID, ctx.message.sticker.file_id);
      } else if (ctx.message.animation) {
        const caption = ctx.message.caption ? `${headerText}\n${ctx.message.caption}` : headerText;
        sentMsg = await ctx.telegram.sendAnimation(MODERATION_CHAT_ID, ctx.message.animation.file_id, {
          caption,
          parse_mode: 'Markdown'
        });
      }
      
      if (sentMsg) {
        questionMap.set(sentMsg.message_id, { userId, username });
        // Добавляем кнопки к сообщению
        await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, sentMsg.message_id, undefined, createReplyKeyboard(sentMsg.message_id));
      }
      
      ctx.reply('Ваше медиа отправлено модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при отправке медиа:', err);
      ctx.reply('Произошла ошибка при отправке медиа.');
    }
  }
});

// Обработка мультимедийных файлов (видео, документы, аудио, голосовые)
bot.on(['video', 'document', 'audio', 'voice'], async (ctx) => {
  const chatId = ctx.chat.id;

  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    const messageId = ctx.message.message_id;
    try {
      await ctx.telegram.copyMessage(MODERATION_CHAT_ID, chatId, messageId);
    } catch (err) {
      console.error('Ошибка пересылки мультимедийного сообщения:', err);
    }
  }
});

// Обработчик кнопок "Ответить" и "Отклонить"
bot.action(/^reply_(.+)$/, async (ctx) => {
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
  await ctx.answerCbQuery('Напишите ответ для пользователя.');
  ctx.reply('Напишите ваш ответ. Когда закончите, отправьте его как ответ на это сообщение.');
});

bot.action(/^cancel_(.+)$/, async (ctx) => {
  const messageId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;

  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    await ctx.answerCbQuery('Только модераторы могут отклонять вопросы.', true);
    return;
  }

  if (!questionMap.has(messageId)) {
    await ctx.answerCbQuery('Вопрос больше не найден.', true);
    return;
  }

  questionMap.delete(messageId);
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.answerCbQuery('Вопрос отклонен.');
});

// Обработчик текстовых сообщений для ответов модераторов
bot.on('text', async (ctx) => {
  if (replySessions.has(ctx.from.id)) {
    const messageId = replySessions.get(ctx.from.id);
    replySessions.delete(ctx.from.id);

    if (!questionMap.has(messageId)) {
      ctx.reply('Вопрос уже обработан или не найден.');
      return;
    }

    const { userId, username } = questionMap.get(messageId);
    try {
      await ctx.telegram.sendMessage(userId, `📝 *Ответ от модератора:*\n${ctx.message.text}`, { parse_mode: 'Markdown' });
      ctx.reply(`Ответ отправлен пользователю ${userId} ${username}`);
    } catch (err) {
      console.error('Ошибка при отправке ответа:', err);
      ctx.reply('Не удалось отправить ответ пользователю.');
    }
  }
});

// Запуск сервера
const express = require('express');
const app = express();
const port = Math.floor(Math.random() * (9000 - 2000 + 1)) + 2000;

app.get('/', (req, res) => {
  res.send('Бот запущен!');
});

function run() {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}

function keepAlive() {
  run();
}

process.on('uncaughtException', (error) => {
  console.error('Необработанное исключение:', error);
  console.log('Перезапускаем бота...');
  bot.launch().catch(err => console.error(err));
});

setInterval(() => {
  bot.telegram.getMe()
    .then(() => {
      console.log('Бот работает корректно');
    })
    .catch(error => {
      console.error('Ошибка при проверке состояния бота:', error);
      console.log('Перезапускаем бота...');
      bot.launch().catch(err => console.error(err));
    });
}, 3600000);

keepAlive();
bot.launch().then(() => {
  console.log('Бот запущен!');
}).catch(err => console.error(err));
