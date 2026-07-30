function isTextQuestionMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (typeof message.text !== 'string' || !message.text.trim()) return false;
  if (message.text.startsWith('/')) return false;
  return true;
}

module.exports = { isTextQuestionMessage };