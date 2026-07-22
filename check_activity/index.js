require('dotenv').config();
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs');

const CONFIG = {
  // Plivo API
  plivo: {
    authId: process.env.PLIVO_AUTH_ID,
    authToken: process.env.PLIVO_AUTH_TOKEN,
    voiceApiUrl: `https://api.plivo.com/v1/Account/${process.env.PLIVO_AUTH_ID}/Call/`,
    zentrunkApiUrl: `https://api.plivo.com/v1/Account/${process.env.PLIVO_AUTH_ID}/Zentrunk/Call/`,
  },

  // Google Sheets
  sheets: {
    sheetId: process.env.GOOGLE_SHEET_ID,
    serviceAccountFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || 'service_account.json',
    lastCallColumn: process.env.LAST_CALL_COLUMN || 'N',
    tabName: process.env.SHEET_TAB_NAME || 'Sheet1',
  },

  // Script settings
  lookbackDays: parseInt(process.env.LOOKBACK_DAYS || '30', 10),
  maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '1', 10),
  batchUpdateSize: parseInt(process.env.BATCH_UPDATE_SIZE || '50', 10),
};

// Validate configuration
if (!CONFIG.plivo.authId || !CONFIG.plivo.authToken) {
  console.error('❌ Error: PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN must be set in .env file');
  process.exit(1);
}

if (!CONFIG.sheets.sheetId) {
  console.error('❌ Error: GOOGLE_SHEET_ID must be set in .env file');
  process.exit(1);
}

if (!fs.existsSync(CONFIG.sheets.serviceAccountFile)) {
  console.error(`❌ Error: Service account file not found: ${CONFIG.sheets.serviceAccountFile}`);
  process.exit(1);
}


const plivoApi = axios.create({
  auth: {
    username: CONFIG.plivo.authId,
    password: CONFIG.plivo.authToken,
  },
  timeout: 120000,
});

const MAX_RETRIES = 3;

async function plivoGet(url, params) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await plivoApi.get(url, { params });
      return response;
    } catch (err) {
      const status = err.response?.status;
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504
        || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';

      if (retryable && attempt < MAX_RETRIES - 1) {
        let delay;
        if (status === 429 || status === 500) {
          // Plivo uses 500 as informal throttling before switching to 429
          delay = 30000; // 30s pause to let API cool down
          console.log(`  ⏸️  Throttled (${status}) - pausing 30s...`);
        } else {
          delay = (3 + attempt * 3) * 1000; // 502/503/504/timeout: wait 3s, 6s, 9s
          console.log(`  ↻ Retry ${attempt + 1}/${MAX_RETRIES} (HTTP ${status || err.code}) - waiting ${delay / 1000}s`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

async function fetchLastVoiceUsage(number, direction = 'outbound') {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - CONFIG.lookbackDays);

  const formatDateForApi = (date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  try {
    const params = {
      end_time__gte: formatDateForApi(startDate),
      limit: 1
    };

    if (direction === 'inbound') {
      params.to_number = number;
    } else {
      params.from_number = number;
    }

    const response = await plivoGet(CONFIG.plivo.voiceApiUrl, params);

    if (response.data.objects && response.data.objects.length > 0) {
      const record = response.data.objects[0];
      const timeStr = record.end_time;
      return parseDate(timeStr);
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function fetchLastZentrunkCall(number, direction = 'outbound') {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - CONFIG.lookbackDays);

  const formatDateForApi = (date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  try {
    const params = {
      end_time__gte: formatDateForApi(startDate),
      end_time__lte: formatDateForApi(endDate),
      limit: 1
    };

    if (direction === 'inbound') {
      params.to_number = number;
    } else {
      params.from_number = number;
    }

    const response = await plivoGet(CONFIG.plivo.zentrunkApiUrl, params);

    if (response.data.objects && response.data.objects.length > 0) {
      const endTime = response.data.objects[0].end_time;
      return parseDate(endTime);
    }
    return null;
  } catch (error) {
    return null;
  }
}

function parseDate(dateStr) {
  if (!dateStr) return null;

  try {
    // Remove timezone info and microseconds
    const cleanStr = dateStr.split('+')[0].split('-').slice(0, 3).join('-').split('.')[0];
    const date = new Date(cleanStr.replace(' ', 'T') + 'Z');

    if (isNaN(date.getTime())) {
      console.warn(`  ⚠️  Failed to parse date: ${dateStr}`);
      return null;
    }

    return date;
  } catch (error) {
    console.warn(`  ⚠️  Error parsing date "${dateStr}":`, error.message);
    return null;
  }
}

function formatDate(date) {
  if (!date) return '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);

  return `${day}/${month}/${year}`;
}

async function getLastCallDate(number) {
  try {
    // Normalize phone number
    const rawNumber = number.trim();
    // Plivo Voice List Calls API matches numbers WITHOUT + prefix (confirmed via dashboard)
    const strippedNumber = rawNumber.startsWith('+') ? rawNumber.substring(1) : rawNumber;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONFIG.lookbackDays);

    // 1. Check Voice Outbound
    const voiceOutDate = await fetchLastVoiceUsage(strippedNumber, 'outbound');
    if (voiceOutDate && voiceOutDate >= cutoffDate) return formatDate(voiceOutDate);
    // Smart Cooldown: If null (4XX error), wait 3s to appease firewall. Else, 200ms.
    await new Promise(resolve => setTimeout(resolve, !voiceOutDate ? 3000 : 200)); 

    // 2. Check Voice Inbound
    const voiceInDate = await fetchLastVoiceUsage(strippedNumber, 'inbound');
    if (voiceInDate && voiceInDate >= cutoffDate) return formatDate(voiceInDate);
    await new Promise(resolve => setTimeout(resolve, !voiceInDate ? 3000 : 200));

    // 3. Check Zentrunk Outbound
    const zentrunkOutDate = await fetchLastZentrunkCall(strippedNumber, 'outbound');
    if (zentrunkOutDate && zentrunkOutDate >= cutoffDate) return formatDate(zentrunkOutDate);
    await new Promise(resolve => setTimeout(resolve, !zentrunkOutDate ? 3000 : 200));

    // 4. Check Zentrunk Inbound
    const zentrunkInDate = await fetchLastZentrunkCall(strippedNumber, 'inbound');
    if (zentrunkInDate && zentrunkInDate >= cutoffDate) return formatDate(zentrunkInDate);

    // Find the most recent date across all directions (Fallback)
    const dates = [voiceOutDate, voiceInDate, zentrunkOutDate, zentrunkInDate].filter(Boolean);
    let latestDate = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;

    // Filter by lookback period (30 days)
    if (latestDate && latestDate < cutoffDate) {
      // Call is older than 30 days, return empty
      return '';
    }

    return formatDate(latestDate);
  } catch (error) {
    console.error(`  ❌ Error checking ${number}:`, error.message);
    return '';
  }
}


async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CONFIG.sheets.serviceAccountFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  return sheets;
}

function columnLetterToIndex(letter) {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return index - 1;
}

async function readSheet(sheets) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: CONFIG.sheets.sheetId,
      range: CONFIG.sheets.tabName,
    });

    return response.data.values || [];
  } catch (error) {
    console.error('❌ Error reading sheet:', error.message);
    throw error;
  }
}
async function ensureLastCallColumn(sheets, headers) {
  const lastCallColIndex = columnLetterToIndex(CONFIG.sheets.lastCallColumn);

  // Check if header exists
  if (headers.length > lastCallColIndex && headers[lastCallColIndex]) {
    console.log(`✓ Column ${CONFIG.sheets.lastCallColumn} already exists: "${headers[lastCallColIndex]}"`);
    return;
  }

  // Create the header
  console.log(`Creating "Last Call" column at ${CONFIG.sheets.lastCallColumn}...`);

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG.sheets.sheetId,
      range: `${CONFIG.sheets.lastCallColumn}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Last Call']],
      },
    });
    console.log('✓ "Last Call" column created');
  } catch (error) {
    console.error('❌ Error creating Last Call column:', error.message);
    throw error;
  }
}

async function batchUpdateSheet(sheets, updates) {
  if (updates.length === 0) return;

  // Sort updates by row number
  updates.sort((a, b) => a.row - b.row);

  // Group consecutive rows for efficient batch updates
  const batches = [];
  let currentBatch = { startRow: updates[0].row, values: [[updates[0].value]] };

  for (let i = 1; i < updates.length; i++) {
    const update = updates[i];

    if (update.row === currentBatch.startRow + currentBatch.values.length) {
      // Consecutive row, add to current batch
      currentBatch.values.push([update.value]);
    } else {
      // Non-consecutive, start new batch
      batches.push(currentBatch);
      currentBatch = { startRow: update.row, values: [[update.value]] };
    }
  }
  batches.push(currentBatch);

  // Prepare batch update request
  const data = batches.map(batch => ({
    range: `${CONFIG.sheets.lastCallColumn}${batch.startRow}:${CONFIG.sheets.lastCallColumn}${batch.startRow + batch.values.length - 1}`,
    values: batch.values,
  }));

  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: CONFIG.sheets.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: data,
      },
    });
    console.log(`  ✓ Updated ${updates.length} cells in ${batches.length} batch(es)`);
  } catch (error) {
    console.error('  ❌ Error batch updating sheet:', error.message);
    throw error;
  }
}

async function main() {
  console.log('\n🚀 Plivo Last Call Checker\n');
  console.log(`Configuration:`);
  console.log(`  - Lookback period: ${CONFIG.lookbackDays} days`);
  console.log(`  - Max concurrent requests: ${CONFIG.maxConcurrentRequests}`);
  console.log(`  - Batch update size: ${CONFIG.batchUpdateSize}`);
  console.log(`  - Last call column: ${CONFIG.sheets.lastCallColumn}\n`);

  // Connect to Google Sheets
  console.log('📊 Connecting to Google Sheets...');
  const sheets = await getSheetsClient();

  // Read sheet data
  console.log('📖 Reading sheet data...');
  const allData = await readSheet(sheets);

  if (allData.length === 0) {
    console.error('❌ Sheet is empty');
    return;
  }

  const headers = allData[0];

  // Find "Number" column
  const numberColIndex = headers.findIndex(h => h && h.toLowerCase() === 'number');
  if (numberColIndex === -1) {
    console.error('❌ "Number" column not found in sheet');
    return;
  }
  console.log(`✓ Found "Number" column at index ${numberColIndex}`);

  // Ensure "Last Call" column exists
  await ensureLastCallColumn(sheets, headers);

  // Get last call column index
  const lastCallColIndex = columnLetterToIndex(CONFIG.sheets.lastCallColumn);

  // Collect numbers to process
  const numbersToProcess = [];

  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    const rowNumber = i + 1; // 1-indexed for sheets

    // Get phone number
    const number = row[numberColIndex]?.trim();
    if (!number) continue;

    // Check if last call already exists
    const existingLastCall = row[lastCallColIndex]?.trim();
    if (existingLastCall) {
      console.log(`  ⏭️  Skipping row ${rowNumber} (${number}) - already has last call: ${existingLastCall}`);
      continue;
    }

    numbersToProcess.push({ number, row: rowNumber });
  }

  const total = numbersToProcess.length;
  console.log(`\n📞 Processing ${total} phone numbers...\n`);

  if (total === 0) {
    console.log('✨ All rows already have last call dates!');
    return;
  }

  // Process numbers concurrently
  let processed = 0;
  let updateBuffer = [];
  let index = 0;

  async function worker() {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= numbersToProcess.length) break;

      const { number, row } = numbersToProcess[currentIndex];
      const lastCallDate = await getLastCallDate(number);

      processed++;
      console.log(`[${processed}/${total}] Row ${row} (${number}): ${lastCallDate || 'No calls found'}`);

      updateBuffer.push({ row, value: lastCallDate });

      // Batch update when buffer reaches threshold
      // Safe: updateBuffer = [] runs before any await, so no double-flush
      if (updateBuffer.length >= CONFIG.batchUpdateSize) {
        const toUpdate = [...updateBuffer];
        updateBuffer = [];
        await batchUpdateSheet(sheets, toUpdate);
      }
    }
  }

  // Launch N concurrent workers
  console.log(`🔀 Launching ${CONFIG.maxConcurrentRequests} concurrent workers...\n`);
  await Promise.all(Array.from({ length: CONFIG.maxConcurrentRequests }, () => worker()));

  // Update remaining records
  if (updateBuffer.length > 0) {
    console.log('\n💾 Saving final updates...');
    await batchUpdateSheet(sheets, updateBuffer);
  }

  console.log('\n✅ All done!\n');
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = { getLastCallDate, fetchLastVoiceUsage, fetchLastZentrunkCall };
