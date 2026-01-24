require('dotenv').config();
const { token } = require('./config');
const { Telegraf } = require('telegraf');

if (!token) {
  console.error('Error: BOT_TOKEN not set. Create a .env file or set BOT_TOKEN env var.');
  process.exit(1);
}

const bot = new Telegraf(token);

const rawModerationChatId = "-1003691307198";
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
const moderatorReplyState = new Map(); // Track which moderator is replying to which question

bot.start((ctx) => {
  ctx.reply(`
✨ *Это — поддержка беседы "БРЕДИМ"* ✨

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

// Обработка кнопок принятия/отклонения вопроса
bot.action(/^(accept|reject|reply)_(\d+)$/, async (ctx) => {
  if (ctx.chat.id !== parseInt(MODERATION_CHAT_ID)) return;

  const action = ctx.match[1];
  const messageId = parseInt(ctx.match[2]);

  if (!questionMap.has(messageId)) {
    return ctx.answerCbQuery('Вопрос не найден.');
  }

  const { userId, username } = questionMap.get(messageId);
  const moderatorId = ctx.from.id;

  if (action === 'reply') {
    moderatorReplyState.set(moderatorId, { messageId, userId, username });
    ctx.answerCbQuery('Напишите ответ на вопрос');
    ctx.reply(`Теперь напишите ответ на вопрос пользователя ${userId} ${username}:`);
  } else if (action === 'reject') {
    try {
      await ctx.telegram.sendMessage(userId, `❌ *Ваш вопрос был отклонен.*\n\nМодератор посчитал, что ваш вопрос не соответствует правилам сообщества. Пожалуйста, прочитайте правила и попробуйте еще раз.`, { parse_mode: 'Markdown' });
      ctx.reply(`❌ Вопрос пользователя ${userId} ${username} отклонен.`);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (err) {
      console.error('Ошибка при отклонении вопроса:', err);
      ctx.answerCbQuery('Не удалось отправить уведомление пользователю.');
    }
  } else if (action === 'accept') {
    ctx.answerCbQuery('Вопрос принят. Ожидаем вашего ответа.', false);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  }
});

bot.on('message', async (ctx) => {
  const chatId = ctx.chat.id;
  const moderatorId = ctx.from.id;

  // Проверяем, находится ли модератор в режиме ответа
  if (chatId === parseInt(MODERATION_CHAT_ID) && moderatorReplyState.has(moderatorId)) {
    const { messageId, userId, username } = moderatorReplyState.get(moderatorId);
    console.log(`Отправляем ответ пользователю ${userId} (${username})`);

    try {
      await ctx.telegram.sendMessage(userId, `📝 *Ответ от модератора:*\n${ctx.message.text}`, { parse_mode: 'Markdown' });
      ctx.reply(`✅ Ответ отправлен пользователю ${userId} ${username}`);
      moderatorReplyState.delete(moderatorId);
      // Очищаем кнопки из вопроса
      try {
        await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, messageId, undefined, { inline_keyboard: [] });
      } catch (err) {
        console.log('Не удалось очистить кнопки сообщения');
      }
    } catch (err) {
      console.error('Ошибка при отправке сообщения пользователю:', err);
      ctx.reply('Не удалось отправить сообщение пользователю. Возможно, он заблокировал бота или не начал чат.');
    }
    return;
  }

  // Обработка ответов модераторов через reply (старый способ)
  if (chatId === parseInt(MODERATION_CHAT_ID)) {
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (!replyMsgId || !questionMap.has(replyMsgId)) {
      ctx.reply('Пожалуйста, используйте кнопку "Ответить" на вопросе или отвечайте на сообщение, содержащее вопрос, используя reply.');
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

  const from = ctx.message.from;
  const userId = from.id.toString();
  if (blockedUsers.has(userId)) {
    return;
  }

  // Пересылка вопроса в модерационный чат
  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    const username = from.username ? `@${from.username}` : '(без username)';
    const questionText = `❓ *Вопрос от пользователя ${userId} ${username}:*\n${ctx.message.text}`;

    try {
      const sentMsg = await ctx.telegram.sendMessage(MODERATION_CHAT_ID, questionText, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💬 Ответить', callback_data: `reply_${sentMsg.message_id}` },
              { text: '✅ Принять', callback_data: `accept_${sentMsg.message_id}` },
              { text: '❌ Отклонить', callback_data: `reject_${sentMsg.message_id}` }
            ]
          ]
        }
      });
      questionMap.set(sentMsg.message_id, { userId, username });
      ctx.reply('Ваш вопрос отправлен модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при отправке вопроса:', err);
      ctx.reply('Произошла ошибка при отправке вопроса.');
    }
  }
});

bot.on(['photo', 'sticker'], async (ctx) => {
  const chatId = ctx.chat.id;

  if (chatId === parseInt(MODERATION_CHAT_ID)) {
    // Handle moderator response with media (photo/sticker)
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (!replyMsgId || !questionMap.has(replyMsgId)) {
      ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
      return;
    }

    const { userId, username } = questionMap.get(replyMsgId);
    console.log(`Отправляем медиа ответ пользователю ${userId} (${username})`);

    try {
      const messageId = ctx.message.message_id;
      await ctx.telegram.copyMessage(userId, chatId, messageId);
      ctx.reply(`Медиа отправлено пользователю ${userId} ${username}`);
    } catch (err) {
      console.error('Ошибка при отправке медиа пользователю:', err);
      ctx.reply('Не удалось отправить медиа пользователю.');
    }
    return;
  }

  // Handle user sending media to moderation
  const from = ctx.message.from;
  const userId = from.id.toString();
  if (blockedUsers.has(userId)) {
    return;
  }

  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    const username = from.username ? `@${from.username}` : '(без username)';
    const mediaLabel = ctx.message.photo ? '📸 Изображение' : '👾 Стикер';
    const headerText = `${mediaLabel} *от пользователя ${userId} ${username}:*`;

    try {
      const messageId = ctx.message.message_id;
      const copiedMsg = await ctx.telegram.copyMessage(
        MODERATION_CHAT_ID,
        chatId,
        messageId,
        { 
          caption: headerText, 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💬 Ответить', callback_data: `reply_${copiedMsg.message_id}` },
                { text: '✅ Принять', callback_data: `accept_${copiedMsg.message_id}` },
                { text: '❌ Отклонить', callback_data: `reject_${copiedMsg.message_id}` }
              ]
            ]
          }
        }
      );
      questionMap.set(copiedMsg.message_id, { userId, username });
      ctx.reply('Ваше медиа отправлено модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при отправке медиа:', err);
      ctx.reply('Произошла ошибка при отправке медиа.');
    }
  }
});



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
