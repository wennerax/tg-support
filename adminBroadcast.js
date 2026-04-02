module.exports = (bot, chatIds, adminUserId) => {
  bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== adminUserId) {
      await ctx.reply('Доступ запрещен. Эта команда только для админов.');
      return;
    }

    const args = ctx.message.text.split(' ').slice(1);
    const message = args.join(' ');

    if (!message.trim()) {
      await ctx.reply('Использование: /broadcast <сообщение>\n\nОтправить сообщение для широковещательной рассылки во все чаты, где присутствует бот.');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const chatId of chatIds) {
      try {
        await bot.telegram.sendMessage(chatId, message);
        successCount++;
      } catch (err) {
        console.error(`Не удалось отправить в чат ${chatId}:`, err.message);
        failCount++;
      }
    }

    await ctx.reply(`Рассылка завершена.\n✅ Отправлено в ${successCount} чатов\n❌ Не удалось отправить в ${failCount} чатов`);
  });
};
