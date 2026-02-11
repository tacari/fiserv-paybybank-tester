# Fiserv Pay by Bank - Test Console

Test application for Commerce Hub Pay by Bank integration using ConnectPay SDK.

## Quick Start

**Python** (recommended if Node.js is blocked):

Windows:
```bash
pip install -r requirements.txt
python server.py
```

Mac/Linux:
```bash
pip3 install -r requirements.txt
python3 server.py
```

**Node.js**:

Windows/Mac/Linux:
```bash
npm install
node server.js
```

Then open **https://localhost:3000** in your browser.

**Note:** You'll see a certificate warning (self-signed cert for local testing). Click "Advanced" → "Proceed to localhost" to continue.

## What Works

[WORKING] **Steps 1-4**: Complete enrollment flow
[WORKING] **SDK Integration**: ConnectPay SDK loads and works
[WORKING] **Enrollment**: Successfully returns nonce
[WORKING] **Charge API**: Accepts requests

[BLOCKED] **Step 5 (Nonce Inquiry)**: Returns 500 error - endpoint not available in cert yet

## Testing

1. Open https://localhost:3000
2. Credentials are pre-filled (ResortCom Cert environment)
3. Click through Steps 1-4
4. For Step 4 (Enrollment), click "Manual" and use test data:
   - Routing: `021000021`
   - Account: `1234567890`
   - Name/Address: Any test values

## Configuration

Credentials are hardcoded in the UI for easy testing. To use different credentials, just change them in the web interface and click "Save Credentials".

## Environment

- **SDK**: `connect-cert.fiservapis.com/pbb` (Commerce Hub Cert)
- **API**: `connect-cert.fiservapis.com/ch` (Commerce Hub Cert)
- **Merchant**: ResortCom (100232000000248)

## Known Issues

**Nonce Inquiry (Step 5)**: Returns 500 error code 703 "Internal Error". Documentation indicates this endpoint may not be fully available in cert environment yet. Once this is resolved, the full end-to-end flow will work.

## Requirements

**Python**: Python 3.6+

**OR**

**Node.js**: Node.js v14+, npm

That's it!
