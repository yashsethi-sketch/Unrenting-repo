# Unrent Scripts Repository

This repository contains two scripts for managing and cleaning up active phone numbers.

## 1. `check_activity` Folder (Number Activity Checker)
This script checks a Google Sheet containing phone numbers and verifies if they have had any activity within the last 30 days (or a custom lookback period defined in your `.env` file). It helps determine which numbers are safe to remove.

**Note:** The Google Sheet should contain a list of your **active numbers** from Plivo. You can obtain this list by using the "Export Numbers" functionality from your Plivo dashboard and pasting the data into the sheet.

### Setup & Usage:
1. Navigate into the `check_activity` directory:
   ```bash
   cd check_activity
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables by creating a `.env` file. You will need your Plivo API credentials, Google Sheet ID, and Google Service Account set up. Here is a sample:
   ```env
   # Plivo API Credentials
   PLIVO_AUTH_ID=ababcbacb
   PLIVO_AUTH_TOKEN=abcdbcdb

   # Google Sheets Configuration
   GOOGLE_SHEET_ID=1oHTQzrxdaG6Z31QT7Qtr8lofHT89gH9ORTN0lTbTuM4
   GOOGLE_SERVICE_ACCOUNT_FILE=service_account.json

   # Configuration (Optional - defaults provided)
   # How many days to look back for calls (default: 90, max: 90)
   LOOKBACK_DAYS=30

   # Maximum concurrent API requests
   MAX_CONCURRENT_REQUESTS=1

   # Batch size for Google Sheets updates (default: 50)
   BATCH_UPDATE_SIZE=50

   # Column letter for last call date (default: N)
   LAST_CALL_COLUMN=N
   ```
4. Replace the contents of `service_account.json` with your actual Google Cloud service account keys.
5. Run the script:
   ```bash
   node index.js
   ```

### Creating the Google Cloud Service Account (`service_account.json`):
To allow the script to read your Google Sheet, you need a Google Cloud Service Account.
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Search for the **Google Sheets API** and click **Enable**.
4. In the left sidebar, go to **IAM & Admin** > **Service Accounts**.
5. Click **Create Service Account** at the top.
6. Provide a name and description, then click **Create and Continue**, and click **Done**.
7. In the list of service accounts, click on the one you just created.
8. Go to the **Keys** tab.
9. Click **Add Key** > **Create new key**.
10. Select **JSON** and click **Create**. The `.json` file will automatically download to your computer.
11. **Important:** Open your target Google Sheet in your browser and share it with the `client_email` address found inside the JSON file (give it **Viewer** or **Editor** access).
12. Copy the contents of the downloaded JSON file and paste them into `check_activity/service_account.json`.

---

## 2. `unrent_script` Folder (Number Unrenter)
This script takes an array of phone numbers from the configuration file and unrents (deletes) them from your provider. 

**Important Safety Note:** This script is configured strictly for *unrenting* numbers. The configuration is set to prevent any accidental number purchases.

### Setup & Usage:
1. Navigate into the `unrent_script` directory:
   ```bash
   cd unrent_script
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables by creating a `.env` file in the `unrent_script` folder
   ```env
   PLIVO_AUTH_ID=your_plivo_auth_id
   PLIVO_AUTH_TOKEN=your_plivo_auth_token
   ```
4. Open `cliPurchaseAndUnrentConfig.json` and add the phone numbers you want to remove into the target array.
5. Verify that `"allowRentOptions"` and `"doYouReallyWantToRentNumbers"` are both set to `false` in the config file.
6. Run the script:
   ```bash
   node cliPurchaseAndUnrent.js
   ```
