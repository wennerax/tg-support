/**
 * Media and Sticker Forwarding Handler
 * Handles forwarding media from users to moderators and vice versa
 */

module.exports = function setupMediaHandler(bot, MODERATION_CHAT_ID, questionMap, blockedUsers, createReplyKeyboard) {
  // Handle all media types: photos, stickers, animations, videos, documents, audio, voice
  bot.on(['photo', 'sticker', 'animation', 'video', 'audio', 'voice', 'document'], async (ctx) => {
    const chatId = ctx.chat.id;
    const from = ctx.message.from;
    const userId = from.id.toString();

    // Moderator replying with media to a user
    if (chatId === parseInt(MODERATION_CHAT_ID)) {
      const replyMsgId = ctx.message.reply_to_message?.message_id;
      
      // Must be a reply to a tracked question
      if (!replyMsgId || !questionMap.has(replyMsgId)) {
        await ctx.reply('Пожалуйста, отвечайте на сообщение, содержащее вопрос, используя reply.');
        return;
      }

      const { userId: targetUserId, username } = questionMap.get(replyMsgId);
      
      try {
        // Copy the media message to the user
        await ctx.telegram.copyMessage(targetUserId, MODERATION_CHAT_ID, ctx.message.message_id, {
          caption: '📝 *Ответ от модератора*',
          parse_mode: 'Markdown'
        });
        
        await ctx.reply(`Медиа отправлены пользователю ${targetUserId} (${username})`);
      } catch (err) {
        console.error('Ошибка при отправке медиа пользователю:', err);
        await ctx.reply('Не удалось отправить медиа пользователю.');
      }
      return;
    }

    // User sending media - check if user is blocked
    if (blockedUsers.has(userId)) return;

    // Forward user's media to moderation chat
    const username = from.username ? `@${from.username}` : '(без username)';
    const caption = ctx.message.caption 
      ? `❓ *Медиа от пользователя ${userId} ${username}:*\n${ctx.message.caption}` 
      : `❓ *Медиа от пользователя ${userId} ${username}*`;

    try {
      // Copy media to moderation chat
      const copiedMsg = await ctx.telegram.copyMessage(MODERATION_CHAT_ID, chatId, ctx.message.message_id, {
        caption,
        parse_mode: 'Markdown'
      });

      // Track the question for reply functionality
      if (copiedMsg) {
        questionMap.set(copiedMsg.message_id, { userId, username });
        
        // Add reply/reject buttons
        await ctx.telegram.editMessageReplyMarkup(
          MODERATION_CHAT_ID,
          copiedMsg.message_id,
          undefined,
          createReplyKeyboard(copiedMsg.message_id)
        );
      }

      ctx.reply('Ваше медиа отправлено модераторам. Ожидайте ответа.');
    } catch (err) {
      console.error('Ошибка при пересылке медиа в чат модерации:', err);
      ctx.reply('Произошла ошибка при отправке медиа.');
    }
  });
};
