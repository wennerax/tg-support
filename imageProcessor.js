const fs = require('fs');
const path = require('path');

class ImageProcessor {
  constructor(telegramInstance) {
    this.telegram = telegramInstance;
    this.tempDir = path.join(__dirname, 'temp');
    this.ensureTempDir();
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }


  async sendImage(chatId, photoFileId, caption = '', options = {}) {
    try {
      const sendOptions = {
        caption,
        parse_mode: 'Markdown',
        ...options
      };

      const sentMessage = await this.telegram.sendPhoto(chatId, photoFileId, sendOptions);
      console.log(`Image sent successfully to chat ${chatId}`);
      return sentMessage;
    } catch (err) {
      console.error('Error sending image:', err);
      throw err;
    }
  }


  async sendSticker(chatId, stickerFileId, options = {}) {
    try {
      const sentMessage = await this.telegram.sendSticker(chatId, stickerFileId, options);
      console.log(`Sticker sent successfully to chat ${chatId}`);
      return sentMessage;
    } catch (err) {
      console.error('Error sending sticker:', err);
      throw err;
    }
  }


  async sendFormattedImage(chatId, photoFileId, config = {}) {
    const {
      caption = '',
      userInfo = '',
      formatAsAnswer = false,
      replyMarkup = null
    } = config;

    let finalCaption = caption;

    if (formatAsAnswer) {
      finalCaption = `📝 *Ответ от модератора:*${caption ? `\n${caption}` : ''}`;
    } else if (userInfo) {
      finalCaption = `❓ *${userInfo}*${caption ? `\n${caption}` : ''}`;
    }

    const options = { reply_markup: replyMarkup };

    return this.sendImage(chatId, photoFileId, finalCaption, options);
  }

  async processLocalImage(filePath, chatId, caption = '') {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const fileStream = fs.createReadStream(filePath);
      return await this.sendImage(chatId, fileStream, caption);
    } catch (err) {
      console.error('Error processing local image:', err);
      throw err;
    }
  }


  async sendMultipleImages(chatId, imageFileIds, caption = '') {
    const results = [];

    try {
      for (const fileId of imageFileIds) {
        const sentMessage = await this.sendImage(chatId, fileId, caption);
        results.push(sentMessage);
       
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      console.log(`Sent ${results.length} images to chat ${chatId}`);
      return results;
    } catch (err) {
      console.error('Error sending multiple images:', err);
      throw err;
    }
  }


  async sendRandomSticker(chatId, stickerFileIds = []) {
    try {
      if (stickerFileIds.length === 0) {
        throw new Error('No sticker file IDs provided');
      }

      const randomSticker = stickerFileIds[Math.floor(Math.random() * stickerFileIds.length)];
      return await this.sendSticker(chatId, randomSticker);
    } catch (err) {
      console.error('Error sending random sticker:', err);
      throw err;
    }
  }


  async getImageFileInfo(fileId) {
    try {
      const file = await this.telegram.getFile(fileId);
      console.log(`File info retrieved: ${fileId}`);
      return file;
    } catch (err) {
      console.error('Error getting file info:', err);
      throw err;
    }
  }


  isImageMessage(message) {
    return message && (message.photo || message.document?.mime_type?.startsWith('image/'));
  }


  isStickerMessage(message) {
    return message && message.sticker;
  }


  getFileIdFromMessage(message) {
    if (!message) return null;

    if (message.photo) {
      // Get the largest photo quality
      return message.photo[message.photo.length - 1].file_id;
    } else if (message.sticker) {
      return message.sticker.file_id;
    } else if (message.document?.mime_type?.startsWith('image/')) {
      return message.document.file_id;
    }

    return null;
  }


  cleanupTempDir() {
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(this.tempDir, file));
        });
        console.log('Temp directory cleaned up');
      }
    } catch (err) {
      console.error('Error cleaning temp directory:', err);
    }
  }


  getImageDimensions(message) {
    if (message && message.photo && message.photo.length > 0) {
      const largestPhoto = message.photo[message.photo.length - 1];
      return {
        width: largestPhoto.width,
        height: largestPhoto.height
      };
    }
    return { width: null, height: null };
  }
}

module.exports = ImageProcessor;
