const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, 'bannedUsers.json');

function loadList(file = DEFAULT_FILE) {
  try {
    if (!fs.existsSync(file)) return new Set();
    const raw = fs.readFileSync(file, 'utf8');
    const arr = JSON.parse(raw || '[]');
    return new Set(arr.map(String));
  } catch (err) {
    console.error('Failed to load banned list:', err);
    return new Set();
  }
}

function saveList(set, file = DEFAULT_FILE) {
  try {
    const arr = Array.from(set);
    fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save banned list:', err);
  }
}

function setupBanCommands(bot, MODERATION_CHAT_ID_NUM, blockedUsers, filePath) {
  const file = filePath || DEFAULT_FILE;

  // load persisted bans into the provided Set
  const persisted = loadList(file);
  for (const id of persisted) blockedUsers.add(String(id));

  // helper to persist current set
  function persist() {
    saveList(blockedUsers, file);
  }

  bot.command('hban', async (ctx) => {
    if (ctx.chat.id !== MODERATION_CHAT_ID_NUM) return;
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length === 0) return ctx.reply('Используйте /hban <user_id> (numeric)');

    const raw = String(args[0]).trim();
    if (!/^\d+$/.test(raw)) return ctx.reply('Некорректный user_id. Используйте только числовой ID.');

    const userIdToBan = raw;
    blockedUsers.add(String(userIdToBan));
    persist();
    ctx.reply(`Пользователь ${userIdToBan} заблокирован.`);
  });

  bot.command('hunban', async (ctx) => {
    if (ctx.chat.id !== MODERATION_CHAT_ID_NUM) return;
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length === 0) return ctx.reply('Используйте /hunban <user_id> (numeric)');

    const raw = String(args[0]).trim();
    if (!/^\d+$/.test(raw)) return ctx.reply('Некорректный user_id. Используйте только числовой ID.');

    const userIdToUnban = raw;
    if (blockedUsers.has(String(userIdToUnban))) {
      blockedUsers.delete(String(userIdToUnban));
      persist();
      ctx.reply(`Пользователь ${userIdToUnban} разблокирован.`);
    } else {
      ctx.reply('Этот пользователь не заблокирован.');
    }
  });

  // list persisted bans
  bot.command('hbans', async (ctx) => {
    if (ctx.chat.id !== MODERATION_CHAT_ID_NUM) return;
    if (blockedUsers.size === 0) return ctx.reply('Список заблокированных пользователей пуст.');

    const lines = [];
    for (const id of blockedUsers) {
      let label = String(id);
      try {
        const user = await ctx.telegram.getChat(id);
        if (user) {
          if (user.username) label = `${id} — @${user.username}`;
          else if (user.first_name || user.last_name) label = `${id} — ${[user.first_name, user.last_name].filter(Boolean).join(' ')}`;
        }
      } catch (err) {
        // ignore resolution errors
      }
      lines.push(label);
    }

    const body = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
    const message = '```\n' + body + '\n```';
    try {
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Failed to send hbans list:', err);
      try { await ctx.reply(lines.map((l, i) => `${i + 1}. ${l}`).join('\n')); } catch {};
    }
  });
}

module.exports = { setupBanCommands, loadList, saveList };
