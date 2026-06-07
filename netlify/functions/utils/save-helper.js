async function saveToSheet(data, googleScriptUrl, secretToken) {
  const payload = {
    ...data,
    secretToken: secretToken || ''
  };

  const response = await fetch(googleScriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Google Script responded with status ${response.status}`);
  }

  const responseText = await response.text();
  try {
    return JSON.parse(responseText);
  } catch (e) {
    return { success: false, error: 'Invalid response from Google Sheets script', raw: responseText };
  }
}

module.exports = { saveToSheet };
