require('dotenv').config();

const token = process.env.BOT_TOKEN || process.env.TOKEN || '';

module.exports = {
  token,
};
