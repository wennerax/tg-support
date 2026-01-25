/**
 * Moderator Reply Handler
 * Handles the flow where moderator clicks "reply" button,
 * button is removed, and moderator writes response without using reply-to-message
 */

module.exports = function setupModeratorReplyHandler(bot, MODERATION_CHAT_ID, questionMap) {
  // Store active reply sessions: moderatorId -> { messageId, isReplyMode: true }
  const moderatorReplySessions = new Map();

  /**
   * Enhanced reply button handler - removes button and enters reply mode
   */
  bot.action(/^reply_(\d+)$/, async (ctx) => {
    const messageId = parseInt(ctx.match[1]);
    const chatId = ctx.chat.id;
    const moderatorId = ctx.from.id;

    // Only moderators can reply
    if (chatId !== parseInt(MODERATION_CHAT_ID)) {
      await ctx.answerCbQuery('Только модераторы могут отвечать.', true);
      return;
    }

    // Check if question exists
    if (!questionMap.has(messageId)) {
      await ctx.answerCbQuery('Вопрос больше не найден.', true);
      return;
    }

    // Remove the button by editing message markup
    try {
      await ctx.editMessageReplyMarkup(undefined);
      await ctx.answerCbQuery('Кнопка удалена. Введите ответ.');
    } catch (err) {
      console.error('Ошибка при удалении кнопки:', err);
      await ctx.answerCbQuery('Ошибка при удалении кнопки.', true);
      return;
    }

    // Store the active reply session
    moderatorReplySessions.set(moderatorId, {
      messageId,
      isReplyMode: true,
      startTime: Date.now()
    });

    // Notify moderator to type response
    try {
      const { userId, username } = questionMap.get(messageId);
      const notifyMsg = await ctx.reply(
        `✏️ *Режим ответа активирован*\nВы отвечаете на вопрос от ${username} (ID: ${userId})\n\n📝 Теперь введите ваш ответ и отправьте его. Я автоматически пошлю его пользователю.`,
        { parse_mode: 'Markdown' }
      );
      
      // Store notification message ID for cleanup if needed
      if (!moderatorReplySessions.has(moderatorId)) {
        moderatorReplySessions.set(moderatorId, {});
      }
      moderatorReplySessions.get(moderatorId).notifyMsgId = notifyMsg.message_id;
    } catch (err) {
      console.error('Ошибка при отправке уведомления:', err);
    }
  });

  /**
   * Handle text input from moderator in reply mode
   * Detects when moderator is in active reply session and sends response
   */
  bot.on('text', async (ctx) => {
    const moderatorId = ctx.from.id;
    const chatId = ctx.chat.id;

    // Only process in moderation chat
    if (chatId !== parseInt(MODERATION_CHAT_ID)) {
      return;
    }

    // Check if moderator has active reply session
    if (!moderatorReplySessions.has(moderatorId)) {
      return;
    }

    const session = moderatorReplySessions.get(moderatorId);
    const { messageId, isReplyMode } = session;

    // Only process if in reply mode
    if (!isReplyMode) {
      return;
    }

    // Check if question still exists
    if (!questionMap.has(messageId)) {
      ctx.reply('❌ Вопрос уже обработан или не найден.');
      moderatorReplySessions.delete(moderatorId);
      return;
    }

    const { userId: targetUserId, username } = questionMap.get(messageId);
    const responseText = ctx.message.text;

    try {
      // Send response to user
      await ctx.telegram.sendMessage(
        targetUserId,
        `📝 *Ответ от модератора:*\n${responseText}`,
        { parse_mode: 'Markdown' }
      );

      // Mark question as processed
      questionMap.delete(messageId);

      // Confirm to moderator
      ctx.reply(`✅ Ответ отправлен пользователю ${username} (ID: ${targetUserId})`);

      // End reply session
      moderatorReplySessions.delete(moderatorId);
    } catch (err) {
      console.error('Ошибка при отправке ответа:', err);
      ctx.reply('❌ Не удалось отправить ответ пользователю.');
    }
  });

  /**
   * Handle media responses from moderator in reply mode
   */
  function setupMediaReplyHandler() {
    bot.on(['photo', 'sticker', 'animation', 'video', 'audio', 'voice', 'document'], async (ctx) => {
      const moderatorId = ctx.from.id;
      const chatId = ctx.chat.id;

      // Only process in moderation chat
      if (chatId !== parseInt(MODERATION_CHAT_ID)) {
        return;
      }

      // Check if moderator has active reply session
      if (!moderatorReplySessions.has(moderatorId)) {
        return;
      }

      const session = moderatorReplySessions.get(moderatorId);
      const { messageId, isReplyMode } = session;

      // Only process if in reply mode
      if (!isReplyMode) {
        return;
      }

      // Check if question still exists
      if (!questionMap.has(messageId)) {
        ctx.reply('❌ Вопрос уже обработан или не найден.');
        moderatorReplySessions.delete(moderatorId);
        return;
      }

      const { userId: targetUserId, username } = questionMap.get(messageId);

      try {
        // Copy media to user with notification
        await ctx.telegram.copyMessage(targetUserId, MODERATION_CHAT_ID, ctx.message.message_id, {
          caption: '📝 *Ответ от модератора*',
          parse_mode: 'Markdown'
        });

        // Mark question as processed
        questionMap.delete(messageId);

        // Confirm to moderator
        ctx.reply(`✅ Медиа отправлено пользователю ${username} (ID: ${targetUserId})`);

        // End reply session
        moderatorReplySessions.delete(moderatorId);
      } catch (err) {
        console.error('Ошибка при отправке медиа:', err);
        ctx.reply('❌ Не удалось отправить медиа пользователю.');
      }
    });
  }

  // Setup media handler
  setupMediaReplyHandler();

  /**
   * Cancel reply session (optional - could be triggered by /cancel command)
   */
  bot.command('cancel', (ctx) => {
    const moderatorId = ctx.from.id;
    const chatId = ctx.chat.id;

    if (chatId !== parseInt(MODERATION_CHAT_ID)) {
      return;
    }

    if (moderatorReplySessions.has(moderatorId)) {
      moderatorReplySessions.delete(moderatorId);
      ctx.reply('❌ Режим ответа отменен.');
    } else {
      ctx.reply('ℹ️ Вы не в режиме ответа.');
    }
  });

  // Return session map for external access if needed
  return {
    getActiveSessions: () => new Map(moderatorReplySessions),
    getSessionForModerator: (moderatorId) => moderatorReplySessions.get(moderatorId),
    clearSession: (moderatorId) => moderatorReplySessions.delete(moderatorId)
  };
};
