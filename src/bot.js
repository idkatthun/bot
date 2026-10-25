// src/bot.js

const mineflayer = require('mineflayer');
const util = require('util');

const CONFIG = {
    host: process.env.HOST || 'localhost',
    port: Number(process.env.PORT) || 25565,
    username: process.env.USERNAME || 'Anonymous',
    version: process.env.VERSION || false,
};

const PASSWORD = (process.env.PASSWORD || '').trim();

const RECONNECT_DELAY_MS = 5000;
const SWING_INTERVAL_MS = 30000;
const AUTH_COOLDOWN_MS = 5000;
const WATCHDOG_INTERVAL_MS = 5000;
const PACKET_TIMEOUT_MS = 10000;

const pad = (n) => String(n).padStart(2, '0');

function log(tag, ...parts) {
    const text = parts
        .map((part) => (typeof part === 'string' ? part : util.inspect(part, { depth: 4, breakLength: Infinity })))
        .join(' ');
    const d = new Date();
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const line = `[${time}] [${tag}]: ${text}`;

    console.log(PASSWORD ? line.split(PASSWORD).join(' ') : line);
}

if (!PASSWORD) {
    log('main/ERROR', 'No password provided.');
    process.exit(1);
}

function formatReason(bot, reason) {
    try {
        const ChatMessage = require('prismarine-chat')(bot.registry);
        let parsed = reason;

        if (typeof reason === 'string') {
            try {
                parsed = JSON.parse(reason);
            } catch {
                return reason;
            }
        }

        return ChatMessage.fromNotch(parsed).toString();
    } catch {
        return typeof reason === 'string' ? reason : JSON.stringify(reason);
    }
}

function hookTickEnd(bot) {
    bot.on('physicTick', () => {
        if (bot._client.state === 'play') bot._client.write('tick_end', {});
    });
}

function authCommand(message) {
    const text = message.toLowerCase();

    if (text.includes('/login')) return `/login ${PASSWORD}`;
    if (text.includes('/register')) return `/register ${PASSWORD} ${PASSWORD}`;

    return null;
}

function hookAuth(bot) {
    let lastAuth = 0;

    bot.on('messagestr', (message) => {
        const now = Date.now();
        if (now - lastAuth < AUTH_COOLDOWN_MS) return;

        const command = authCommand(message);
        if (!command) return;

        lastAuth = now;
        bot.chat(command);
    });
}

function hookWatchdog(bot) {
    let lastPacket = Date.now();

    bot._client.on('packet', () => {
        lastPacket = Date.now();
    });

    const interval = setInterval(() => {
        if (Date.now() - lastPacket < PACKET_TIMEOUT_MS) return;

        clearInterval(interval);

        bot.end('Timed out');
        if (bot._client.socket) bot._client.socket.destroy();
    }, WATCHDOG_INTERVAL_MS);

    bot.once('end', () => clearInterval(interval));
}

function startSwinging(bot) {
    return setInterval(() => {
        try {
            bot.swingArm();
        } catch (err) {
            log('Render thread/ERROR', err.message);
        }
    }, SWING_INTERVAL_MS);
}

function start() {
    let bot;

    log('Render thread/INFO', `Connecting to ${CONFIG.host}:${CONFIG.port}`);

    try {
        bot = mineflayer.createBot(CONFIG);
    } catch (err) {
        log('main/ERROR', err.message);
        setTimeout(start, RECONNECT_DELAY_MS);
        return;
    }

    let timer = null;
    let kickReason = null;

    hookTickEnd(bot);
    hookAuth(bot);
    hookWatchdog(bot);

    bot.once('login', () => {
        log('Render thread/INFO', `${CONFIG.username} joined the game`);
        timer = startSwinging(bot);
    });

    bot.on('kicked', (reason) => {
        kickReason = formatReason(bot, reason);
        log('Render thread/WARN', `Kicked from server. Reason: ${kickReason}`);
    });

    bot.on('error', (err) =>
        log('Render thread/ERROR', err.message)
    );

    bot.on('end', (reason) => {
        clearInterval(timer);
        log('Render thread/INFO', `Disconnected from server. Reason: ${kickReason ?? reason}`);
        log('Render thread/INFO', `Reconnecting to server in ${RECONNECT_DELAY_MS / 1000} seconds`);
        setTimeout(start, RECONNECT_DELAY_MS);
    });
}

start();
