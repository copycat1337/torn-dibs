# CAT Dibs

A lightweight Torn userscript and Node.js service for coordinating faction war targets. CAT Dibs lets faction members claim targets, see who has claimed each player, and avoid multiple members calling the same target.

## Features

- **Claim targets:** Claim a player directly from the faction members list.
- **One active claim per player:** A player can only hold one claim at a time.
- **Claim ownership:** See who claimed each target. Only the member who made a claim can manually cancel it.
- **Hospital status monitoring:** Checks target status and releases a claim after a confirmed combat-related hospitalization.
- **Ipecac:** Using Ipecac does not, by itself, release or reset a claim.
- **Automatic status refresh:** Claimed-target status is checked every **20 seconds** by default.
- **Ranked-war detection:** Detects your faction's current ranked-war opponent automatically.

## How claim release works

CAT Dibs does not release a claim just because a target is already in the hospital. It first needs to observe the target outside the hospital after the claim was made. If that target later enters the hospital for a recognized combat reason, the claim can be released automatically.

Recognized combat descriptions include being **hospitalized by**, **attacked by**, **mugged by**, or **losing to** another player.

Self-hospitalization, overdoses, accidents, unknown reasons, and a target who was already hospitalized before being claimed do **not** automatically release the claim.

## Polling and API usage

The userscript uses these default polling intervals:

| Task | Interval | What it does |
| --- | ---: | --- |
| Claim list sync | 3 seconds | Requests the active claims from the CAT Dibs server (`GET /api/calls`). |
| Page button refresh | 2 seconds | Updates the claim buttons shown in the faction members list. This is local page/UI work, not a Torn API request. |
| Target/faction status check | 20 seconds | Checks faction member status and evaluates eligible claims for combat-related hospital release. |
| Ranked-war opponent check | 120 seconds | Checks the Torn API for your current ranked-war opponent. |

### Torn API request estimate

The script uses Torn API v2:

- `GET /v2/faction/{factionId}/wars` — detects the current ranked-war opponent.
- `GET /v2/faction/{factionId}/members` — reads faction member statuses. During a detected ranked war, it checks your faction and the opponent faction.

At the default 20-second status interval, the status monitor makes up to **2 faction-member requests per cycle** when an opponent is detected (approximately **6 requests per minute**), or **1 per cycle** when no opponent is detected (approximately **3 requests per minute**). The ranked-war endpoint is checked at most once every 2 minutes (approximately **0.5 request per minute**), excluding the initial forced check and retries/failures.

The claim-list requests go to your CAT Dibs server, **not** to Torn's API. Actual Torn API usage can vary with open Torn tabs, other scripts using the same API key, and failed/retried requests. Avoid running multiple CAT Dibs tabs unnecessarily.

Torn currently documents a limit of **100 requests per minute per user across all of their API keys**. Torn also documents a service IP limit of **5,000 requests per minute**. Limits may change, so check the [official Torn API documentation](https://www.torn.com/api.html).

## Requirements

- Node.js and npm
- A Torn API key with access to the faction information required by the script
- Your faction ID
- A userscript manager that supports the `GM_*` functions used by the script (for example, Tampermonkey or ScriptCat)
- The CAT Dibs userscript (`dibs.js`)

## Installation and startup

### 1. Install dependencies

From the project directory:

```bash
npm install
```

### 2. Configure environment variables

Create or edit the `.env` file in the project directory:

```env
FACTION_ID=CHANGE_ME
API_TOKEN=CHANGE_ME
```

Set `FACTION_ID` to your faction ID and `API_TOKEN` to the Torn API token used by the CAT Dibs service. Keep this file private and do not commit real API tokens to GitHub.

### 3. Initialize the database

Run this once on first setup:

```bash
npm run db:init
```

This creates the database used by the service.

### 4. Start the server

```bash
node server.js
```

The default server port is **3701**.

Keep the server running while faction members use the userscript.

### 5. Configure the userscript address

Open `dibs.js` and edit the `@namespace` line near the top:

```javascript
// @namespace    https://YOUR_URL_HERE.COM/
```

Replace the placeholder with the IP address or domain name that users will use to reach your CAT Dibs server. The server address configured in the script must also be reachable by users' browsers.

> **Configuration note:** In the supplied `dibs.js`, the actual server URL is set by the `SERVER` constant near the top of the file. If you are changing the server host, update that constant as well as the `@namespace` metadata line:
>
> ```javascript
> const SERVER = "https://YOUR_URL_HERE.COM";
> ```
>
> The `@namespace` value is userscript metadata; changing it alone does not change where API requests are sent.

### 6. Install and connect the userscript

1. Open your userscript manager.
2. Create a new userscript and paste in the contents of `dibs.js`, or install the file using your manager's supported method.
3. Open Torn and visit your faction page.
4. Open the userscript manager's menu and select **Set Torn API Key**.
5. Enter your Torn API key and complete registration.
6. Reload the faction page. The claim buttons should appear beside faction members.

The script stores the registered login details in the userscript manager's local storage. Use **Disconnect / Wipe Account** from its menu to clear them.

## Docker

To start the service with Docker Compose:

```bash
docker compose up -d
```

The default service port is **3701**. Make sure the port is published in your Compose configuration and that the configured server address is reachable by users.

To view the container logs:

```bash
docker compose logs -f
```

To stop the service:

```bash
docker compose down
```

## Database reset

**Warning:** This removes the existing CAT Dibs database data. Use it only if you intend to wipe and rebuild the database.

```bash
npm run db:reset
```

After resetting, initialize or start the service as required by your project setup.

## Configuration summary

| Setting | Default / value |
| --- | --- |
| Server port | `3701` |
| `FACTION_ID` | Set in `.env` |
| `API_TOKEN` | Set in `.env` |
| Claim list sync | 3 seconds |
| Target status polling | 20 seconds |
| Ranked-war opponent polling | 120 seconds |
| Page button refresh | 2 seconds |

## Notes

- The CAT Dibs server must remain online for claim synchronization between faction members.
- Each user should register their own Torn API key through the userscript menu.
- Do not publish your `.env` file or share API keys.
- The userscript runs its faction-page features on Torn pages matching `https://www.torn.com/*`, and initializes the claim interface on the faction page.

---

**CAT Dibs** — faction war target calling, made simple.
