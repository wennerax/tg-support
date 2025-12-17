require('dotenv').config();
const { token } = require('./config');
const { Telegraf } = require('telegraf');

if (!token) {
  console.error('Error: BOT_TOKEN not set. Create a .env file or set BOT_TOKEN env var.');
  process.exit(1);
}

const bot = new Telegraf(token);

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

bot.start((ctx) => {
  ctx.reply(`
✨ *Это — поддержка беседы "БРЕДИМ"* ✨

📝 Здесь ты можешь задать свой вопрос, а наши модераторы ответят в кратчайшие сроки.

🌟 *Просто напиши свой вопрос, и мы обязательно свяжемся с тобой!*

📩 *Жду твоего сообщения!*`, { parse_mode: 'Markdown' });
});

// Обработка команд /ban и /unban (без изменений)
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

// Обработка текстовых сообщений и пересылка вопросов
bot.on('message', async (ctx) => {
  const chatId = ctx.chat.id;

  // Обработка ответов модераторов
  if (chatId === parseInt(MODERATION_CHAT_ID)) {
    const replyMsgId = ctx.message.reply_to_message?.message_id;
    if (!replyMsgId || !questionMap.has(replyMsgId)) {
      ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
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

  // Проверка, что пользователь не заблокирован
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
      const sentMsg = await ctx.telegram.sendMessage(MODERATION_CHAT_ID, questionText, { parse_mode: 'Markdown' });
      questionMap.set(sentMsg.message_id, { userId, username });
      ctx.reply('Ваш вопрос отправлен модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при отправке вопроса:', err);
      ctx.reply('Произошла ошибка при отправке вопроса.');
    }
  }
});

// Обработка мультимедийных сообщений (стикеры, фото, видео, анимации)
bot.on(['sticker', 'photo', 'animation', 'video'], async (ctx) => {
  const chatId = ctx.chat.id;

  if (chatId !== parseInt(MODERATION_CHAT_ID)) {
    const messageId = ctx.message.message_id;

    try {
      await ctx.telegram.copyMessage(
        MODERATION_CHAT_ID,
        chatId,
        messageId
      );
    } catch (err) {
      console.error('Ошибка пересылки мультимедийного сообщения:', err);
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
}, 60000);

keepAlive();
bot.launch().then(() => {
  console.log('Бот запущен!');
}).catch(err => console.error(err));