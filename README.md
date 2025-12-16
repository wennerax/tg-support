# Telegram Bot (Node.js + Telegraf)

Simple Telegram bot scaffold using telegraf.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Provide your bot token (from BotFather) in an env var named `BOT_TOKEN`.

- PowerShell:

```powershell
$env:BOT_TOKEN = "<your-token>"
npm start
```

- Command Prompt (cmd.exe):

```cmd
set BOT_TOKEN=<your-token>
npm start
```

Or create a `.env` file with:

```
BOT_TOKEN=your_token_here
```

3. Start:

```bash
npm start
```

## Commands

- `/start` - greeting
- `/help` - list commands
- `/ping` - replies `pong`
- `/echo <text>` - echoes provided text

## Files

- `index.js` - bot implementation
- `package.json` - project metadata

## Next steps

- Add persistent storage, admin commands, or webhook deployment.