# Fiserv Pay by Bank - Test Console

Test application for Commerce Hub Pay by Bank integration.

## Setup Instructions

1. **Download the zip file** from GitHub and extract it (right-click > Extract All on Windows, or double-click on Mac)

2. **Open Terminal/Command Prompt**
   - Windows: Press Windows key, type "cmd", press Enter
   - Mac: Press Cmd+Space, type "terminal", press Enter

3. **Navigate to the folder**

   If it extracted to your Downloads folder:

   Windows:
   ```
   cd Downloads\fiserv-paybybank-tester-main
   ```

   Mac:
   ```
   cd ~/Downloads/fiserv-paybybank-tester-main
   ```

4. **Install requirements**

   Windows:
   ```
   pip install -r requirements.txt
   ```

   Mac:
   ```
   pip3 install -r requirements.txt
   ```

5. **Start the server**

   Windows:
   ```
   python server.py
   ```

   Mac:
   ```
   python3 server.py
   ```

6. **Open your browser** and go to: **https://localhost:3000**

   You'll see a security warning (this is normal for local testing). Click "Advanced" or "Show Details" and then "Proceed to localhost" or "Visit this website".

## Testing the Integration

1. Open https://localhost:3000
2. All credentials are already filled in
3. Click through Steps 1-4 in order
4. For Step 4 (Enrollment), click "Manual" and enter:
   - Routing: `021000021`
   - Account: `1234567890`
   - Name/Address: Any test values

## What Works

Steps 1-4 work completely. Step 5 (Nonce Inquiry) returns a 500 error because the endpoint isn't available in cert environment yet.

## Requirements

Python 3.6 or higher must be installed on your computer.
