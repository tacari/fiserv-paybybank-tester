var express = require('express');
var https = require('https');
var fs = require('fs');
var crypto = require('crypto');
var axios = require('axios');
var cors = require('cors');
require('dotenv').config();

var app = express();
var PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Commerce Hub cert base
var CH_BASE = 'https://connect-cert.fiservapis.com/ch';

// HMAC signature per Commerce Hub spec
function buildSignature(apiKey, secret, clientRequestId, timestamp, payload) {
  var raw = apiKey + clientRequestId + timestamp;
  if (payload) raw += JSON.stringify(payload);
  var hmac = crypto.createHmac('sha256', secret);
  hmac.update(raw);
  return hmac.digest('base64');
}

function buildHeaders(apiKey, secret, payload) {
  var ts = Date.now().toString();
  var reqId = ts + '-' + crypto.randomBytes(4).toString('hex');
  var sig = buildSignature(apiKey, secret, reqId, ts, payload);
  return {
    'Content-Type': 'application/json',
    'Api-Key': apiKey,
    'Timestamp': ts,
    'Client-Request-Id': reqId,
    'Auth-Token-Type': 'HMAC',
    'Authorization': sig
  };
}

// helper to call Commerce Hub and return result
async function callCH(path, apiKey, secret, payload) {
  var url = CH_BASE + path;
  var headers = buildHeaders(apiKey, secret, payload);
  console.log('[CH]', 'POST', url);
  var response = await axios.post(url, payload, { headers: headers, timeout: 30000 });
  return response;
}

// health
app.get('/api/health', function(req, res) {
  res.json({ status: 'running', time: new Date().toISOString() });
});

// test connectivity
app.post('/api/test-connection', async function(req, res) {
  var c = req.body;
  if (!c.apiKey || !c.apiSecret) return res.status(400).json({ error: 'Missing API credentials - check your .env file or UI inputs' });

  try {
    var payload = {
      amount: { total: 0.01, currency: 'USD' },
      source: { sourceType: 'PaymentCheck', check: { checkType: 'PERSONAL', accountNumber: '1234567890', routingNumber: '021000021' } },
      transactionDetails: { captureFlag: false },
      merchantDetails: { merchantId: c.merchantId, terminalId: c.terminalId }
    };
    var r = await callCH('/payments/v1/charges', c.apiKey, c.apiSecret, payload);
    res.json({ success: true, httpStatus: r.status, rawResponse: r.data });
  } catch (err) {
    var status = err.response ? err.response.status : 0;
    var data = err.response ? err.response.data : null;
    var credsOk = status >= 400 && status < 500 && status !== 401 && status !== 403;
    res.json({
      success: credsOk || status === 201,
      note: credsOk ? 'Credentials authenticated. Business rejection expected for test.' : 'Could not authenticate.',
      httpStatus: status, rawResponse: data, errorMessage: err.message
    });
  }
});

// ============================================================
// STEP 1: Create customer profile
// POST /payments-vas/v1/tokens
// ============================================================
app.post('/api/create-customer', async function(req, res) {
  var c = req.body;
  if (!c.apiKey || !c.apiSecret || !c.merchantId) return res.status(400).json({ error: 'Creds required' });

  try {
    var payload = {
      customer: {
        merchantCustomerId: c.merchantCustomerId || ('CUST-' + Date.now())
      },
      merchantDetails: {
        merchantId: c.merchantId,
        terminalId: c.terminalId
      },
      transactionDetails: {
        tokenProvider: 'FISERV_PAY_BY_BANK',
        operationType: 'CREATE'
      }
    };

    var r = await callCH('/payments-vas/v1/tokens', c.apiKey, c.apiSecret, payload);
    console.log('[create-customer] response:', JSON.stringify(r.data, null, 2));

    res.json({
      success: true,
      httpStatus: r.status,
      providerCustomerId: r.data.customer ? r.data.customer.providerCustomerId : null,
      merchantCustomerId: payload.customer.merchantCustomerId,
      data: r.data
    });
  } catch (err) {
    var d = err.response ? err.response.data : null;
    console.log('[create-customer] error:', err.response ? err.response.status : 'net', d || err.message);
    res.status(err.response ? err.response.status : 500).json({
      success: false, httpStatus: err.response ? err.response.status : 0,
      data: d, message: err.message || 'Something went wrong creating the customer profile. Double-check your merchant credentials.'
    });
  }
});

// ============================================================
// STEP 2: Get provider credentials (session token for SDK)
// POST /payments-vas/v1/security/provider-credentials
// ============================================================
app.post('/api/provider-credentials', async function(req, res) {
  var c = req.body;
  if (!c.apiKey || !c.apiSecret || !c.merchantId) return res.status(400).json({ error: 'Creds required' });

  try {
    var payload = {
      providerCredentials: {
        credentialType: 'FISERV_PAY_BY_BANK',
        attributes: [
          { key: 'publicKeyRequired', value: 'true' },
          { key: 'configIdRequired', value: 'true' }
        ]
      },
      merchantDetails: {
        merchantId: c.merchantId,
        terminalId: c.terminalId
      }
    };

    // add providerCustomerId if provided
    if (c.providerCustomerId) {
      payload.providerCredentials.attributes.push({
        key: 'tokenData',
        value: c.providerCustomerId
      });
    }

    // add configId if provided
    if (c.configId) {
      payload.providerCredentials.attributes.push({
        key: 'configId',
        value: c.configId
      });
    }

    var r = await callCH('/payments-vas/v1/security/provider-credentials', c.apiKey, c.apiSecret, payload);
    console.log('[provider-credentials] response:', JSON.stringify(r.data, null, 2));

    // extract the attributes into a flat object for easy reading
    var creds = {};
    if (r.data.providerCredentials && r.data.providerCredentials.attributes) {
      r.data.providerCredentials.attributes.forEach(function(attr) {
        creds[attr.key] = attr.value;
      });
    }

    res.json({
      success: true,
      httpStatus: r.status,
      credentials: creds,
      data: r.data
    });
  } catch (err) {
    var d = err.response ? err.response.data : null;
    console.log('[provider-credentials] error:', err.response ? err.response.status : 'net', d || err.message);
    res.status(err.response ? err.response.status : 500).json({
      success: false, httpStatus: err.response ? err.response.status : 0,
      data: d, message: err.message
    });
  }
});

// ============================================================
// STEP 4: Nonce inquiry (detokenize)
// POST /payments-vas/v1/tokens
// ============================================================
app.post('/api/nonce-inquiry', async function(req, res) {
  var c = req.body;
  if (!c.apiKey || !c.apiSecret || !c.merchantId) return res.status(400).json({ error: 'Creds required' });

  try {
    var payload = {
      source: {
        sourceType: 'PaymentToken',
        tokenData: c.nonce,
        tokenSource: 'FISERV_PAY_BY_BANK'
      },
      merchantDetails: {
        merchantId: c.merchantId,
        terminalId: c.terminalId
      }
    };

    // Add customer if provided
    if (c.providerCustomerId || c.merchantCustomerId) {
      payload.customer = {};
      if (c.merchantCustomerId) payload.customer.merchantCustomerId = c.merchantCustomerId;
      if (c.providerCustomerId) payload.customer.providerCustomerId = c.providerCustomerId;
    }

    var r = await callCH('/payments-vas/v1/tokens', c.apiKey, c.apiSecret, payload);
    console.log('[nonce-inquiry] response:', JSON.stringify(r.data, null, 2));

    res.json({
      success: true,
      httpStatus: r.status,
      tokenData: r.data.source ? r.data.source.tokenData : null,
      data: r.data
    });
  } catch (err) {
    var d = err.response ? err.response.data : null;
    console.log('[nonce-inquiry] error:', err.response ? err.response.status : 'net', d || err.message);
    var helpfulMsg = err.response && err.response.status === 500
      ? 'Backend returned 500 error - nonce inquiry endpoint might not be available yet in cert'
      : err.message;
    res.status(err.response ? err.response.status : 500).json({
      success: false, httpStatus: err.response ? err.response.status : 0,
      data: d, message: helpfulMsg
    });
  }
});

// ============================================================
// STEP 5: Charge with PaymentToken
// POST /payments/v1/charges
// ============================================================
app.post('/api/charges', async function(req, res) {
  var body = req.body;
  if (!body.apiKey || !body.apiSecret || !body.merchantId) return res.status(400).json({ error: 'Creds required' });

  try {
    var payload = {
      amount: {
        total: parseFloat(body.amount) || 1.00,
        currency: 'USD'
      },
      source: body.source || { sourceType: 'PaymentToken', tokenSource: 'FISERV_PAY_BY_BANK' },
      transactionDetails: {
        captureFlag: body.captureFlag !== false
      },
      merchantDetails: {
        merchantId: body.merchantId,
        terminalId: body.terminalId
      },
      transactionInteraction: {
        origin: 'ECOM'
      }
    };

    // add customer if we have providerCustomerId
    if (body.providerCustomerId || body.merchantCustomerId) {
      payload.customer = {};
      if (body.merchantCustomerId) payload.customer.merchantCustomerId = body.merchantCustomerId;
      if (body.providerCustomerId) payload.customer.providerCustomerId = body.providerCustomerId;
    }

    var r = await callCH('/payments/v1/charges', body.apiKey, body.apiSecret, payload);
    console.log('[charges] response:', JSON.stringify(r.data, null, 2));

    res.json({ success: true, httpStatus: r.status, data: r.data });
  } catch (err) {
    var d = err.response ? err.response.data : null;
    console.log('[charges] error:', err.response ? err.response.status : 'net', d || err.message);
    res.status(err.response ? err.response.status : 500).json({
      success: false, httpStatus: err.response ? err.response.status : 0,
      data: d, message: err.message
    });
  }
});

// generic proxy
app.post('/api/proxy', async function(req, res) {
  var body = req.body;
  if (!body.apiKey || !body.apiSecret) return res.status(400).json({ error: 'Creds required' });

  try {
    var url = CH_BASE + (body.endpoint || '/payments/v1/charges');
    var method = (body.method || 'POST').toUpperCase();
    var payload = body.payload || {};

    if (!payload.merchantDetails && body.merchantId) {
      payload.merchantDetails = { merchantId: body.merchantId, terminalId: body.terminalId };
    }

    var headers = buildHeaders(body.apiKey, body.apiSecret, method === 'GET' ? null : payload);
    var axiosConfig = { headers: headers, timeout: 30000 };
    var response;

    if (method === 'GET') response = await axios.get(url, axiosConfig);
    else response = await axios.post(url, payload, axiosConfig);

    res.json({ success: true, httpStatus: response.status, data: response.data });
  } catch (err) {
    var d = err.response ? err.response.data : null;
    res.status(err.response ? err.response.status : 500).json({
      success: false, httpStatus: err.response ? err.response.status : 0, data: d, message: err.message
    });
  }
});

// Read SSL certificate files
var httpsOptions = {
  key: fs.readFileSync('./server.key'),
  cert: fs.readFileSync('./server.cert')
};

// Create HTTPS server
https.createServer(httpsOptions, app).listen(PORT, function() {
  console.log('');
  console.log('  Fiserv PbB Tester running on https://localhost:' + PORT);
  console.log('  Commerce Hub: connect-cert.fiservapis.com');
  console.log('  ConnectPay SDK: cat.api.firstdata.com');
  console.log('');
  console.log('  NOTE: You may see a browser warning about the self-signed certificate.');
  console.log('  Click "Advanced" or "Proceed" to continue (safe for local development).');
  console.log('');
});
