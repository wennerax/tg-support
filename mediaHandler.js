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
      // Check if moderator is in active reply mode
      ctx.session = ctx.session || {};
      if (ctx.session.activeReplySession) {
        const { messageId, userId: targetUserId, username } = ctx.session.activeReplySession;
        
        try {
          // Copy the media message to the user
          await ctx.telegram.copyMessage(targetUserId, MODERATION_CHAT_ID, ctx.message.message_id, {
            caption: '📝 Ответ от модератора'
          });

          await ctx.reply(`Медиа отправлены пользователю ${targetUserId} (${username})`);
          
          // Clear the active reply session and restore original buttons
          ctx.session.activeReplySession = null;
          // Mark question as answered and remove moderation message
          questionMap.delete(messageId);
          try {
            await ctx.telegram.deleteMessage(MODERATION_CHAT_ID, messageId);
          } catch (err) {
            console.error('Could not delete moderation message after media reply:', err);
          }
        } catch (err) {
          console.error('Ошибка при отправке медиа пользователю:', err);
          await ctx.reply('Не удалось отправить медиа пользователю.');
        }
        return;
      }

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
          caption: '📝 Ответ от модератора'
        });

        await ctx.reply(`Медиа отправлены пользователю ${targetUserId} (${username})`);
        // Mark question as answered and remove moderation message
        questionMap.delete(replyMsgId);
        try {
          await ctx.telegram.deleteMessage(MODERATION_CHAT_ID, replyMsgId);
        } catch (err) {
          console.error('Could not delete moderation message after media reply:', err);
        }
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
      ? `❓ Медиа от пользователя ${userId} ${username}:\n${ctx.message.caption}` 
      : `❓ Медиа от пользователя ${userId} ${username}`;

    try {
      // Copy media to moderation chat
      const copiedMsg = await ctx.telegram.copyMessage(MODERATION_CHAT_ID, chatId, ctx.message.message_id, {
        caption
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

