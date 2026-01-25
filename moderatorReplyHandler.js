/**
 * Moderator Reply Handler
 * Handles the reply button click - removes the reply button and shows cancel button
 */

module.exports = function setupModeratorReplyHandler(bot, MODERATION_CHAT_ID, questionMap, lockedQuestions) {
  // Обработка кнопки "Ответить"
  bot.action(/^reply_(\d+)$/, async (ctx) => {
    const messageId = parseInt(ctx.match[1]);
    const chatId = ctx.chat.id;
    
    if (chatId !== parseInt(MODERATION_CHAT_ID)) {
      await ctx.answerCbQuery('Только модераторы могут отвечать.', true);
      return;
    }
    
    if (!questionMap.has(messageId)) {
      await ctx.answerCbQuery('Вопрос уже обработан или не найден.', true);
      return;
    }

    // Check if question is already locked by another moderator
    if (lockedQuestions.has(messageId)) {
      await ctx.answerCbQuery('Этот вопрос уже обрабатывается другим модератором.', true);
      return;
    }

    const { userId, username } = questionMap.get(messageId);

    try {
      // Lock the question
      lockedQuestions.add(messageId);

      // Replace the reply button with cancel button
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [
          [
            { text: '❌ Отмена', callback_data: `cancel_reply_${messageId}` }
          ]
        ]
      });

      // Store the active reply session
      ctx.session = ctx.session || {};
      ctx.session.activeReplySession = {
        messageId,
        userId,
        username,
        started: Date.now()
      };

      // Notify the moderator that they can now write the reply
      await ctx.answerCbQuery('Напишите ответ в чат. Нажмите "Отмена" чтобы выйти из режима ответа.');
    } catch (err) {
      console.error('Ошибка при обработке кнопки reply:', err);
      await ctx.answerCbQuery('Произошла ошибка.', true);
    }
  });

  // Handle cancel reply button
  bot.action(/^cancel_reply_(\d+)$/, async (ctx) => {
    const messageId = parseInt(ctx.match[1]);
    const chatId = ctx.chat.id;
    
    if (chatId !== parseInt(MODERATION_CHAT_ID)) {
      await ctx.answerCbQuery('Только модераторы могут отменять.', true);
      return;
    }

    ctx.session = ctx.session || {};
    ctx.session.activeReplySession = null;
    lockedQuestions.delete(messageId);

    try {
      // Restore the original reply and reject buttons
      const replyKeyboard = {
        inline_keyboard: [
          [
            { text: '💬 Ответить', callback_data: `reply_${messageId}` },
            { text: '✖️ Отклонить', callback_data: `cancel_${messageId}` }
          ]
        ]
      };
      
      await ctx.editMessageReplyMarkup(replyKeyboard);
      await ctx.answerCbQuery('Режим ответа отменен.');
    } catch (err) {
      console.error('Ошибка при отмене режима ответа:', err);
      await ctx.answerCbQuery('Произошла ошибка.', true);
    }
  });
};
