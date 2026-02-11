from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import hmac
import hashlib
import base64
import time
import secrets
import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='.')
CORS(app)

PORT = int(os.getenv('PORT', 3000))
CH_BASE = 'https://connect-cert.fiservapis.com/ch'

def build_signature(api_key, secret, client_request_id, timestamp, payload=None):
    raw = api_key + client_request_id + timestamp
    if payload:
        raw += json.dumps(payload, separators=(',', ':'))
    signature = hmac.new(secret.encode(), raw.encode(), hashlib.sha256).digest()
    return base64.b64encode(signature).decode()

def build_headers(api_key, secret, payload=None):
    ts = str(int(time.time() * 1000))
    req_id = ts + '-' + secrets.token_hex(4)
    sig = build_signature(api_key, secret, req_id, ts, payload)
    return {
        'Content-Type': 'application/json',
        'Api-Key': api_key,
        'Timestamp': ts,
        'Client-Request-Id': req_id,
        'Auth-Token-Type': 'HMAC',
        'Authorization': sig
    }

def call_ch(path, api_key, secret, payload):
    url = CH_BASE + path
    payload_str = json.dumps(payload, separators=(',', ':'))
    headers = build_headers(api_key, secret, payload)
    headers['Content-Type'] = 'application/json'
    print(f'[CH] POST {url}')
    response = requests.post(url, data=payload_str, headers=headers, timeout=30)
    return response

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

@app.route('/api/health')
def health():
    return jsonify({'status': 'running', 'time': time.strftime('%Y-%m-%dT%H:%M:%S')})

@app.route('/api/test-connection', methods=['POST'])
def test_connection():
    c = request.json
    if not c.get('apiKey') or not c.get('apiSecret'):
        return jsonify({'error': 'Missing API credentials - check your .env file or UI inputs'}), 400

    try:
        payload = {
            'amount': {'total': 0.01, 'currency': 'USD'},
            'source': {'sourceType': 'PaymentCheck', 'check': {'checkType': 'PERSONAL', 'accountNumber': '1234567890', 'routingNumber': '021000021'}},
            'transactionDetails': {'captureFlag': False},
            'merchantDetails': {'merchantId': c['merchantId'], 'terminalId': c['terminalId']}
        }
        r = call_ch('/payments/v1/charges', c['apiKey'], c['apiSecret'], payload)
        return jsonify({'success': True, 'httpStatus': r.status_code, 'rawResponse': r.json()})
    except Exception as err:
        status = err.response.status_code if hasattr(err, 'response') else 0
        data = err.response.json() if hasattr(err, 'response') else None
        creds_ok = 400 <= status < 500 and status not in [401, 403]
        return jsonify({
            'success': creds_ok or status == 201,
            'note': 'Credentials authenticated. Business rejection expected for test.' if creds_ok else 'Could not authenticate.',
            'httpStatus': status,
            'rawResponse': data,
            'errorMessage': str(err)
        })

@app.route('/api/create-customer', methods=['POST'])
def create_customer():
    c = request.json
    if not c.get('apiKey') or not c.get('apiSecret') or not c.get('merchantId'):
        return jsonify({'error': 'Creds required'}), 400

    try:
        payload = {
            'customer': {
                'merchantCustomerId': c.get('merchantCustomerId', f'CUST-{int(time.time() * 1000)}')
            },
            'merchantDetails': {
                'merchantId': c['merchantId'],
                'terminalId': c['terminalId']
            },
            'transactionDetails': {
                'tokenProvider': 'FISERV_PAY_BY_BANK',
                'operationType': 'CREATE'
            }
        }

        r = call_ch('/payments-vas/v1/tokens', c['apiKey'], c['apiSecret'], payload)
        print(f'[create-customer] response: {json.dumps(r.json(), indent=2)}')

        data = r.json()
        return jsonify({
            'success': True,
            'httpStatus': r.status_code,
            'providerCustomerId': data.get('customer', {}).get('providerCustomerId'),
            'merchantCustomerId': payload['customer']['merchantCustomerId'],
            'data': data
        })
    except Exception as err:
        d = err.response.json() if hasattr(err, 'response') else None
        status = err.response.status_code if hasattr(err, 'response') else 0
        print(f'[create-customer] error: {status} {d or str(err)}')
        return jsonify({
            'success': False,
            'httpStatus': status,
            'data': d,
            'message': str(err) or 'Something went wrong creating the customer profile. Double-check your merchant credentials.'
        }), status or 500

@app.route('/api/provider-credentials', methods=['POST'])
def provider_credentials():
    c = request.json
    if not c.get('apiKey') or not c.get('apiSecret') or not c.get('merchantId'):
        return jsonify({'error': 'Creds required'}), 400

    try:
        payload = {
            'providerCredentials': {
                'credentialType': 'FISERV_PAY_BY_BANK',
                'attributes': [
                    {'key': 'publicKeyRequired', 'value': 'true'},
                    {'key': 'configIdRequired', 'value': 'true'}
                ]
            },
            'merchantDetails': {
                'merchantId': c['merchantId'],
                'terminalId': c['terminalId']
            }
        }

        if c.get('providerCustomerId'):
            payload['providerCredentials']['attributes'].append({
                'key': 'tokenData',
                'value': c['providerCustomerId']
            })

        if c.get('configId'):
            payload['providerCredentials']['attributes'].append({
                'key': 'configId',
                'value': c['configId']
            })

        r = call_ch('/payments-vas/v1/security/provider-credentials', c['apiKey'], c['apiSecret'], payload)
        print(f'[provider-credentials] response: {json.dumps(r.json(), indent=2)}')

        creds = {}
        data = r.json()
        if data.get('providerCredentials', {}).get('attributes'):
            for attr in data['providerCredentials']['attributes']:
                creds[attr['key']] = attr['value']

        return jsonify({
            'success': True,
            'httpStatus': r.status_code,
            'credentials': creds,
            'data': data
        })
    except Exception as err:
        d = err.response.json() if hasattr(err, 'response') else None
        status = err.response.status_code if hasattr(err, 'response') else 0
        print(f'[provider-credentials] error: {status} {d or str(err)}')
        return jsonify({
            'success': False,
            'httpStatus': status,
            'data': d,
            'message': str(err)
        }), status or 500

@app.route('/api/nonce-inquiry', methods=['POST'])
def nonce_inquiry():
    c = request.json
    if not c.get('apiKey') or not c.get('apiSecret') or not c.get('merchantId'):
        return jsonify({'error': 'Creds required'}), 400

    try:
        payload = {
            'source': {
                'sourceType': 'PaymentToken',
                'tokenData': c['nonce'],
                'tokenSource': 'FISERV_PAY_BY_BANK'
            },
            'merchantDetails': {
                'merchantId': c['merchantId'],
                'terminalId': c['terminalId']
            }
        }

        if c.get('providerCustomerId') or c.get('merchantCustomerId'):
            payload['customer'] = {}
            if c.get('merchantCustomerId'):
                payload['customer']['merchantCustomerId'] = c['merchantCustomerId']
            if c.get('providerCustomerId'):
                payload['customer']['providerCustomerId'] = c['providerCustomerId']

        r = call_ch('/payments-vas/v1/tokens', c['apiKey'], c['apiSecret'], payload)
        print(f'[nonce-inquiry] response: {json.dumps(r.json(), indent=2)}')

        data = r.json()
        return jsonify({
            'success': True,
            'httpStatus': r.status_code,
            'tokenData': data.get('source', {}).get('tokenData'),
            'data': data
        })
    except Exception as err:
        d = err.response.json() if hasattr(err, 'response') else None
        status = err.response.status_code if hasattr(err, 'response') else 0
        print(f'[nonce-inquiry] error: {status} {d or str(err)}')
        helpful_msg = 'Backend returned 500 error - nonce inquiry endpoint might not be available yet in cert' if status == 500 else str(err)
        return jsonify({
            'success': False,
            'httpStatus': status,
            'data': d,
            'message': helpful_msg
        }), status or 500

@app.route('/api/charges', methods=['POST'])
def charges():
    body = request.json
    if not body.get('apiKey') or not body.get('apiSecret') or not body.get('merchantId'):
        return jsonify({'error': 'Creds required'}), 400

    try:
        payload = {
            'amount': {
                'total': float(body.get('amount', 1.00)),
                'currency': 'USD'
            },
            'source': body.get('source', {'sourceType': 'PaymentToken', 'tokenSource': 'FISERV_PAY_BY_BANK'}),
            'transactionDetails': {
                'captureFlag': body.get('captureFlag', True)
            },
            'merchantDetails': {
                'merchantId': body['merchantId'],
                'terminalId': body['terminalId']
            },
            'transactionInteraction': {
                'origin': 'ECOM'
            }
        }

        if body.get('providerCustomerId') or body.get('merchantCustomerId'):
            payload['customer'] = {}
            if body.get('merchantCustomerId'):
                payload['customer']['merchantCustomerId'] = body['merchantCustomerId']
            if body.get('providerCustomerId'):
                payload['customer']['providerCustomerId'] = body['providerCustomerId']

        r = call_ch('/payments/v1/charges', body['apiKey'], body['apiSecret'], payload)
        print(f'[charges] response: {json.dumps(r.json(), indent=2)}')

        return jsonify({'success': True, 'httpStatus': r.status_code, 'data': r.json()})
    except Exception as err:
        d = err.response.json() if hasattr(err, 'response') else None
        status = err.response.status_code if hasattr(err, 'response') else 0
        print(f'[charges] error: {status} {d or str(err)}')
        return jsonify({
            'success': False,
            'httpStatus': status,
            'data': d,
            'message': str(err)
        }), status or 500

@app.route('/api/proxy', methods=['POST'])
def proxy():
    body = request.json
    if not body.get('apiKey') or not body.get('apiSecret'):
        return jsonify({'error': 'Creds required'}), 400

    try:
        url = CH_BASE + body.get('endpoint', '/payments/v1/charges')
        method = body.get('method', 'POST').upper()
        payload = body.get('payload', {})

        if not payload.get('merchantDetails') and body.get('merchantId'):
            payload['merchantDetails'] = {'merchantId': body['merchantId'], 'terminalId': body['terminalId']}

        headers = build_headers(body['apiKey'], body['apiSecret'], None if method == 'GET' else payload)

        if method == 'GET':
            response = requests.get(url, headers=headers, timeout=30)
        else:
            response = requests.post(url, json=payload, headers=headers, timeout=30)

        return jsonify({'success': True, 'httpStatus': response.status_code, 'data': response.json()})
    except Exception as err:
        d = err.response.json() if hasattr(err, 'response') else None
        status = err.response.status_code if hasattr(err, 'response') else 0
        return jsonify({
            'success': False,
            'httpStatus': status,
            'data': d,
            'message': str(err)
        }), status or 500

if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=PORT,
        ssl_context=('server.cert', 'server.key'),
        debug=False
    )
