const { callOCRSpace } = require('./utils/ocr-helper');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { base64Image, language, ocrEngine } = JSON.parse(event.body);

    if (!base64Image) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing base64Image' })
      };
    }

    const apiKey = process.env.OCR_SPACE_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error: Missing API Key' })
      };
    }

    const parsedText = await callOCRSpace(base64Image, language || 'eng', ocrEngine || 2, apiKey);

    const mockResponse = {
      ParsedResults: [
        {
          ParsedText: parsedText
        }
      ]
    };

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mockResponse)
    };
  } catch (error) {
    console.error('OCR Function Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
