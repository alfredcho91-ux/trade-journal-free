# API Connection Guide

Trade Journal reads your exchange history to build a journal and analysis. It does not place orders, change positions, or withdraw funds.

## 1. Create an API key at your exchange

1. Sign in to the exchange you use.
2. Open the API management page and create a new key.
3. Set the permission to **Read Only**.
4. Disable order, futures trading, withdrawal, and asset-transfer permissions.
5. If available, restrict the key to the IP address of the computer running Trade Journal.
6. Save the API Key and Secret somewhere safe if the exchange shows the Secret only once.

Trade Journal supports Deepcoin SWAP and Binance. Deepcoin requires a Passphrase.

## 2. Connect Trade Journal

1. Open Trade Journal.
2. Open `API Connection` on the `Journal` page.
3. Select your exchange.
4. Enter the API Key and API Secret.
5. Enter the Deepcoin Passphrase when connecting Deepcoin. A Passphrase is the separate password you created when making the API key.
6. Click `Verify and save connection`.
7. The first connection automatically syncs the most recent 30 days.

After connecting, use `Sync` to import a different period. Duplicate fills are deduplicated using exchange identifiers.

## 3. How credentials are stored

- Desktop builds store credentials in the operating system secure credential store, not browser storage.
- API Secrets are not displayed in the interface or written to logs.
- Deleting a connection also deletes its stored credentials.
- The application does not send order or withdrawal requests to exchanges.

## 4. If connection fails

- Confirm that the key is Read Only.
- Check that the Secret and Passphrase were not swapped.
- If IP restrictions are enabled, confirm that your current public IP is allowed.
- Select `SWAP` for derivatives history. Binance spot history is not part of the official desktop release scope.
- Start with a shorter sync period if the exchange rate-limits long history requests.

Never share your API Key or Secret with another person or include them in screenshots.
