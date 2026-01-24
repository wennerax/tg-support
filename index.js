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

// Обработка кнопок принятия/отклонения/ответа на вопрос
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
    ctx.answerCbQuery('Напишите ответ на вопрос (текст, фото, видео, стикер, гиф)');
    await ctx.reply(`📨 Теперь отправьте ответ на вопрос пользователя ${userId} ${username}.\n\nВы можете отправить: текст, фото, видео, гиф или стикер.`);
  } else if (action === 'reject') {
    try {
      await ctx.telegram.sendMessage(userId, `❌ *Ваш вопрос был отклонен.*\n\nМодератор посчитал, что ваш вопрос не соответствует правилам сообщества. Пожалуйста, прочитайте правила и попробуйте еще раз.`, { parse_mode: 'Markdown' });
      ctx.answerCbQuery('Вопрос отклонен');
      await ctx.reply(`❌ Вопрос пользователя ${userId} ${username} отклонен.`);
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
      await ctx.reply(`✅ Ответ отправлен пользователю ${userId} ${username}`);
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
    if (replyMsgId && questionMap.has(replyMsgId)) {
      const { userId, username } = questionMap.get(replyMsgId);
      console.log(`Отправляем ответ пользователю ${userId} (${username})`);

      try {
        await ctx.telegram.sendMessage(userId, `📝 *Ответ от модератора:*\n${ctx.message.text}`, { parse_mode: 'Markdown' });
        await ctx.reply(`Ответ отправлен пользователю ${userId} ${username}`);
      } catch (err) {
        console.error('Ошибка при отправке сообщения пользователю:', err);
        await ctx.reply('Не удалось отправить сообщение пользователю. Возможно, он заблокировал бота или не начал чат.');
      }
      return;
    }
    // Если это просто сообщение модератора в чате, не отвечая на вопрос - игнорируем
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

    let sentMsg;
    try {
      sentMsg = await ctx.telegram.sendMessage(MODERATION_CHAT_ID, questionText, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💬 Ответить', callback_data: `reply_PLACEHOLDER` },
              { text: '✅ Принять', callback_data: `accept_PLACEHOLDER` },
              { text: '❌ Отклонить', callback_data: `reject_PLACEHOLDER` }
            ]
          ]
        }
      });
      // После отправки сообщения, обновляем кнопки с правильным message_id
      await ctx.telegram.editMessageReplyMarkup(
        MODERATION_CHAT_ID,
        sentMsg.message_id,
        undefined,
        {
          inline_keyboard: [
            [
              { text: '💬 Ответить', callback_data: `reply_${sentMsg.message_id}` },
              { text: '✅ Принять', callback_data: `accept_${sentMsg.message_id}` },
              { text: '❌ Отклонить', callback_data: `reject_${sentMsg.message_id}` }
            ]
          ]
        }
      );
      questionMap.set(sentMsg.message_id, { userId, username });
      ctx.reply('Ваш вопрос отправлен модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при отправке вопроса:', err);
      ctx.reply('Произошла ошибка при отправке вопроса.');
    }
  }
});

bot.on(['photo', 'animation', 'video', 'document', 'sticker'], async (ctx) => {
  const chatId = ctx.chat.id;
  const moderatorId = ctx.from.id;

  // Проверяем, находится ли модератор в режиме ответа (отправляет медиа пользователю)
  if (chatId === parseInt(MODERATION_CHAT_ID) && moderatorReplyState.has(moderatorId)) {
    const { messageId, userId, username } = moderatorReplyState.get(moderatorId);
    console.log(`Отправляем медиа ответ пользователю ${userId} (${username})`);

    try {
      // Копируем сообщение с медиа пользователю
      const result = await ctx.telegram.copyMessage(userId, chatId, ctx.message.message_id);
      await ctx.reply(`✅ Ответ отправлен пользователю ${userId} ${username}`);
      moderatorReplyState.delete(moderatorId);
      
      // Очищаем кнопки из вопроса
      try {
        await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, messageId, undefined, { inline_keyboard: [] });
      } catch (err) {
        console.log('Не удалось очистить кнопки сообщения');
      }
    } catch (err) {
      console.error('Ошибка при отправке медиа пользователю:', err);
      await ctx.reply('Не удалось отправить медиа пользователю.');
    }
    return;
  }

  // Обработка модератора, отвечающего через reply на вопрос медиа
  if (chatId === parseInt(MODERATION_CHAT_ID)) {
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (replyMsgId && questionMap.has(replyMsgId)) {
      const { userId, username } = questionMap.get(replyMsgId);
      console.log(`Отправляем медиа ответ пользователю ${userId} (${username})`);

      try {
        const result = await ctx.telegram.copyMessage(userId, chatId, ctx.message.message_id);
        await ctx.reply(`Медиа отправлено пользователю ${userId} ${username}`);
      } catch (err) {
        console.error('Ошибка при отправке медиа пользователю:', err);
        await ctx.reply('Не удалось отправить медиа пользователю.');
      }
      return;
    }
    // Если модератор просто отправляет медиа в чат - игнорируем
    return;
  }

  // Обработка пользователя, отправляющего медиа как вопрос
  const from = ctx.message.from;
  const userId = from.id.toString();
  if (blockedUsers.has(userId)) {
    return;
  }

  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    const username = from.username ? `@${from.username}` : '(без username)';
    
    let mediaLabel = '📎 Файл';
    if (ctx.message.photo) mediaLabel = '📸 Изображение';
    else if (ctx.message.animation) mediaLabel = '🎬 Гифка';
    else if (ctx.message.video) mediaLabel = '🎥 Видео';
    else if (ctx.message.sticker) mediaLabel = '👾 Стикер';
    else if (ctx.message.document) mediaLabel = '📄 Документ';

    const headerText = `${mediaLabel} *от пользователя ${userId} ${username}:*`;

    try {
      const result = await ctx.telegram.copyMessage(
        MODERATION_CHAT_ID,
        chatId,
        ctx.message.message_id,
        { 
          caption: headerText, 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💬 Ответить', callback_data: `reply_${result.message_id}` },
                { text: '✅ Принять', callback_data: `accept_${result.message_id}` },
                { text: '❌ Отклонить', callback_data: `reject_${result.message_id}` }
              ]
            ]
          }
        }
      );
      questionMap.set(result.message_id, { userId, username });
      ctx.reply('Ваше медиа отправлено модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при копировании медиа:', err);
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
