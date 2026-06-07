const { runOCR } = require('./utils/ocr-helper');
const { extractDoctorFields } = require('./utils/parser-helper');
const { saveToSheet } = require('./utils/save-helper');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  try {
    const update = JSON.parse(event.body);
    const message = update.message;

    if (!message) {
      return { statusCode: 200, body: 'No message in update' };
    }

    const chatId = message.chat.id;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const ocrSpaceKey = process.env.OCR_SPACE_KEY;
    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
    const secretToken = process.env.GOOGLE_SHEETS_SECRET_TOKEN;

    if (!botToken) {
      console.error('Missing TELEGRAM_BOT_TOKEN');
      return { statusCode: 200, body: 'Bot token not configured' };
    }

    // 1. Handle Commands (e.g. /start or /help)
    if (message.text && message.text.startsWith('/')) {
      const text = message.text.trim().toLowerCase();
      if (text === '/start' || text === '/help') {
        const welcomeText = 
          `👋 <b>Welcome to MEDREP Connect!</b>\n\n` +
          `I am an AI-powered Doctor Card Reader bot. Here is how to use me:\n\n` +
          `📷 <b>Step 1:</b> Snap and send me a clear photo of a doctor's business card or prescription.\n` +
          `🔍 <b>Step 2:</b> I will automatically run English & Arabic OCR to extract the details.\n` +
          `📝 <b>Step 3:</b> I will save the doctor's details directly into your Google Sheet and send you a confirmation!\n\n` +
          `<i>Tip: Make sure the photo is well-lit and the text is readable.</i>`;
        
        await sendTelegramMessage(botToken, chatId, welcomeText);
      }
      return { statusCode: 200, body: 'Command handled' };
    }

    // 2. Handle Photo Uploads
    if (message.photo && message.photo.length > 0) {
      const statusMsg = await sendTelegramMessage(botToken, chatId, "⏳ <b>Processing image...</b> Running OCR and extracting details.");
      const statusMsgId = statusMsg ? statusMsg.message_id : null;

      try {
        const photo = message.photo[message.photo.length - 1];
        const fileId = photo.file_id;

        const fileInfoResp = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        if (!fileInfoResp.ok) throw new Error('Failed to get file info from Telegram');
        
        const fileInfo = await fileInfoResp.json();
        if (!fileInfo.ok || !fileInfo.result?.file_path) throw new Error('Telegram did not return file path');
        
        const filePath = fileInfo.result.file_path;

        const fileResp = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
        if (!fileResp.ok) throw new Error('Failed to download image from Telegram');
        
        const arrayBuffer = await fileResp.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        const base64Image = `data:image/jpeg;base64,${base64}`;

        if (statusMsgId) await editTelegramMessage(botToken, chatId, statusMsgId, "🔍 <b>Running AI OCR...</b> Reading Arabic and English text.");
        const ocrText = await runOCR(base64Image, ocrSpaceKey);

        if (!ocrText || ocrText.trim().length < 5) {
          throw new Error('Could not read any readable text from the image.');
        }

        if (statusMsgId) await editTelegramMessage(botToken, chatId, statusMsgId, "📝 <b>Extracting fields...</b> Structuring details.");
        const fields = extractDoctorFields(ocrText);

        const hasData = fields.doctorNameArabic || fields.doctorNameEnglish || fields.mobile1 || fields.specialty;
        if (!hasData) {
          const rawPreview = ocrText.substring(0, 150) + (ocrText.length > 150 ? '...' : '');
          const failMsg = 
            `⚠ <b>Extraction failed</b>\n\n` +
            `I could read some text, but couldn't find a doctor's name, phone, or specialty.\n\n` +
            `<b>Raw text preview:</b>\n<code>${rawPreview}</code>\n\n` +
            `Please try sending a clearer photo of the card.`;
          
          if (statusMsgId) {
            await editTelegramMessage(botToken, chatId, statusMsgId, failMsg);
          } else {
            await sendTelegramMessage(botToken, chatId, failMsg);
          }
          return { statusCode: 200, body: 'Extraction failed (no structured data)' };
        }

        if (statusMsgId) await editTelegramMessage(botToken, chatId, statusMsgId, "💾 <b>Saving to Google Sheets...</b>");
        const saveResult = await saveToSheet(fields, googleScriptUrl, secretToken);

        if (!saveResult.success) {
          throw new Error(saveResult.error || 'Failed to save to Google Sheets.');
        }

        const successText = 
          `✅ <b>Doctor Details Saved!</b>\n\n` +
          `👤 <b>اسم الطبيب (عربي):</b> ${fields.doctorNameArabic || '—'}\n` +
          `👤 <b>Doctor Name (Eng):</b> ${fields.doctorNameEnglish || '—'}\n` +
          `⚕️ <b>Specialty:</b> ${fields.specialty || '—'}\n` +
          `📞 <b>Mobile 1:</b> <code>${fields.mobile1 || '—'}</code>\n` +
          `📞 <b>Mobile 2:</b> <code>${fields.mobile2 || '—'}</code>\n` +
          `✉️ <b>Email:</b> ${fields.email || '—'}\n` +
          `📍 <b>Address 1:</b> ${fields.address1 || '—'}\n` +
          `📍 <b>Address 2:</b> ${fields.address2 || '—'}`;

        if (statusMsgId) {
          await editTelegramMessage(botToken, chatId, statusMsgId, successText);
        } else {
          await sendTelegramMessage(botToken, chatId, successText);
        }

      } catch (err) {
        console.error('Error processing card:', err);
        const errMsg = `❌ <b>Error:</b> ${err.message || 'Unknown processing error.'}\n\nPlease try again.`;
        if (statusMsgId) {
          await editTelegramMessage(botToken, chatId, statusMsgId, errMsg);
        } else {
          await sendTelegramMessage(botToken, chatId, errMsg);
        }
      }
      return { statusCode: 200, body: 'Photo processed' };
    }

    const fallbackText = 
      `ℹ️ <b>Please send a photo!</b>\n\n` +
      `To scan a doctor's card or prescription, simply tap the attachment icon (📎) or camera icon, select a photo, and send it to me.`;
    await sendTelegramMessage(botToken, chatId, fallbackText);

    return { statusCode: 200, body: 'Text response sent' };

  } catch (error) {
    console.error('Telegram Webhook Global Error:', error);
    return {
      statusCode: 200,
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function sendTelegramMessage(token, chatId, text, parseMode = 'HTML') {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: parseMode
    })
  });
  if (res.ok) {
    const data = await res.json();
    return data.result;
  }
  return null;
}

async function editTelegramMessage(token, chatId, messageId, text, parseMode = 'HTML') {
  const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: parseMode
    })
  });
  if (res.ok) {
    const data = await res.json();
    return data.result;
  }
  return null;
}
