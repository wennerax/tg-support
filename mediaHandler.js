/**
 * Media and Sticker Forwarding Handler
 * Handles forwarding media from users to moderators and vice versa
 */

module.exports = function setupMediaHandler(bot, MODERATION_CHAT_ID, questionMap, blockedUsers, createReplyKeyboard) {
  bot.on(['photo', 'sticker', 'animation', 'video', 'audio', 'voice', 'document'], async (ctx) => {
    const chatId = ctx.chat?.id;
    const from = ctx.message?.from;
    if (!chatId || !from) return;

    const userId = String(from.id);
    const isModeratorChat = chatId === Number(MODERATION_CHAT_ID);

    if (isModeratorChat) {
      ctx.session = ctx.session || {};
      const replyMsgId = ctx.message.reply_to_message?.message_id;
      const hasTrackedQuestion = replyMsgId && questionMap.has(replyMsgId);

      if (!hasTrackedQuestion && !ctx.session.activeReplySession) {
        await ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
        return;
      }

      try {
        const target = ctx.session.activeReplySession
          ? ctx.session.activeReplySession
          : questionMap.get(replyMsgId);

        if (!target || !target.userId) {
          throw new Error('No reply target');
        }

        await ctx.telegram.copyMessage(target.userId, MODERATION_CHAT_ID, ctx.message.message_id, {
          caption: '📝 Ответ от модератора'
        });

        await ctx.reply(`Медиа отправлены пользователю ${target.userId} (${target.username || ''})`);

        if (ctx.session.activeReplySession) {
          ctx.session.activeReplySession = null;
          questionMap.delete(target.messageId);
          try {
            await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, target.messageId, undefined, undefined);
          } catch (err) {
            console.error('Could not edit moderation message after media reply:', err);
          }
        } else if (replyMsgId) {
          questionMap.delete(replyMsgId);
          try {
            await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, replyMsgId, undefined, undefined);
          } catch (err) {
            console.error('Could not edit moderation message after media reply:', err);
          }
        }
      } catch (err) {
        console.error('Ошибка при отправке медиа пользователю:', err);
        await ctx.reply('Не удалось отправить медиа пользователю.');
      }
      return;
    }

    if (blockedUsers.has(userId)) return;

    const username = from.username ? `@${from.username}` : '(без username)';
    const caption = ctx.message.caption
      ? `❓ Медиа от пользователя ${userId} ${username}:\n${ctx.message.caption}`
      : `❓ Медиа от пользователя ${userId} ${username}`;

    try {
      const copiedMsg = await ctx.telegram.copyMessage(MODERATION_CHAT_ID, chatId, ctx.message.message_id, {
        caption
      });

      if (copiedMsg?.message_id) {
        questionMap.set(copiedMsg.message_id, { userId, username });
        await ctx.telegram.editMessageReplyMarkup(MODERATION_CHAT_ID, copiedMsg.message_id, undefined, createReplyKeyboard(copiedMsg.message_id));
      }

      ctx.reply('Ваше медиа отправлено модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при пересылке медиа в чат модерации:', err);
      ctx.reply('Произошла ошибка при отправке медиа.');
    }
  });
};
