/**
 * Moderator Reply Handler
 * Handles the reply workflow: when moderator clicks reply button,
 * the button is deleted and a cancel button appears.
 * The moderator's response is captured and stored.
 */

module.exports = function setupModeratorReplyHandler(bot, MODERATION_CHAT_ID, questionMap) {
  // Track active reply sessions: moderatorId -> { messageId, cancelMessageId }
  const activeReplySessions = new Map();

  // Handle the "Reply" button click
  bot.action(/^reply_(.+)$/, async (ctx) => {
    try {
      const messageId = parseInt(ctx.match[1], 10);

      // Check if this message is tracked
      if (!questionMap.has(messageId)) {
        await ctx.answerCbQuery('Сообщение больше не доступно.');
        return;
      }

      const moderatorId = ctx.from.id;

      // Delete the reply button (remove inline keyboard)
      await ctx.telegram.editMessageReplyMarkup(
        MODERATION_CHAT_ID,
        messageId,
        undefined,
        {
          inline_keyboard: []
        }
      );

      // Send message with Cancel button and instructions
      const cancelMsg = await ctx.reply(
        '✏️ *Напишите свой ответ* (отправьте текст сообщения и оно будет отправлено пользователю)',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '❌ Отменить', callback_data: `cancel_reply_${messageId}` }
              ]
            ]
          }
        }
      );

      // Track this reply session
      activeReplySessions.set(moderatorId, {
        messageId,
        cancelMessageId: cancelMsg.message_id,
        targetUserId: questionMap.get(messageId).userId,
        username: questionMap.get(messageId).username
      });

      // Acknowledge the button click
      await ctx.answerCbQuery('Режим ответа активирован');
    } catch (err) {
      console.error('Ошибка при обработке нажатия кнопки reply:', err);
      await ctx.answerCbQuery('Произошла ошибка');
    }
  });

  // Handle the "Cancel Reply" button click
  bot.action(/^cancel_reply_(.+)$/, async (ctx) => {
    try {
      const messageId = parseInt(ctx.match[1], 10);
      const moderatorId = ctx.from.id;

      // Check if this reply session exists
      if (!activeReplySessions.has(moderatorId)) {
        await ctx.answerCbQuery('Сеанс ответа истёк');
        return;
      }

      const sessionData = activeReplySessions.get(moderatorId);

      // Delete the cancel button message
      await ctx.telegram.deleteMessage(MODERATION_CHAT_ID, sessionData.cancelMessageId);

      // Restore the reply button
      if (questionMap.has(messageId)) {
        await ctx.telegram.editMessageReplyMarkup(
          MODERATION_CHAT_ID,
          messageId,
          undefined,
          {
            inline_keyboard: [
              [
                { text: '💬 Ответить', callback_data: `reply_${messageId}` },
                { text: '✖️ Отклонить', callback_data: `cancel_${messageId}` }
              ]
            ]
          }
        );
      }

      // Remove the reply session
      activeReplySessions.delete(moderatorId);

      await ctx.answerCbQuery('Ответ отменён');
    } catch (err) {
      console.error('Ошибка при отмене ответа:', err);
      await ctx.answerCbQuery('Произошла ошибка');
    }
  });

  // Capture moderator's text response (only during active reply session)
  bot.on('text', async (ctx) => {
    // Only process in moderation chat
    if (ctx.chat.id !== parseInt(MODERATION_CHAT_ID)) return;

    const moderatorId = ctx.from.id;

    // Check if there's an active reply session for this moderator
    if (!activeReplySessions.has(moderatorId)) return;

    try {
      const sessionData = activeReplySessions.get(moderatorId);
      const targetUserId = sessionData.targetUserId;
      const username = sessionData.username;
      const responseText = ctx.message.text;
      const messageId = sessionData.messageId;

      // Send the moderator's response to the user
      await ctx.telegram.sendMessage(
        targetUserId,
        `📝 *Ответ от модератора:*\n\n${responseText}`,
        { parse_mode: 'Markdown' }
      );

      // Confirm to moderator
      await ctx.reply(`✅ Ответ отправлен пользователю ${targetUserId} (${username})`);

      // Delete the cancel button message
      await ctx.telegram.deleteMessage(MODERATION_CHAT_ID, sessionData.cancelMessageId);

      // Remove the reply session
      activeReplySessions.delete(moderatorId);

      // Log the response (optional - for record keeping)
      console.log(`[REPLY SENT] Original message ID: ${messageId}, Target user: ${targetUserId}, Response: ${responseText}`);
    } catch (err) {
      console.error('Ошибка при отправке ответа пользователю:', err);
      await ctx.reply('❌ Не удалось отправить ответ. Попробуйте ещё раз.');
    }
  });
};
