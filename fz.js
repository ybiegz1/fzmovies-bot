const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');

const execAsync = util.promisify(exec);
const searches = new Map(); // for FzMovies bot
const infoCache = new Map(); // for .info command

const GROUP_LINK = 'https://chat.whatsapp.com/Bwtuw9F2yjUGNMMayhdamv';
const OMDB_API_KEY = '3a086ca3'; // <-- your OMDb API key

/* ================= START BOT ================= */
async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) start();
            else console.log('❌ Logged out. Delete session folder.');
        }

        if (connection === 'open') {
            console.log('✅ Movie Bot online');
            console.log('Use: .movie <name> or .info <name>');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m?.message) return;

        const chatId = m.key.remoteJid;
        const text =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            '';

        try {
            // ================= .MOVIE =================
            if (text.startsWith('.movie')) {
                await handleMovieSearch(sock, chatId, text);
            }
            // ================= .INFO =================
            else if (text.startsWith('.info')) {
                await handleMovieInfo(sock, chatId, text);
            }
            // ================= Reply 1-5 for FzMovies =================
            else if (/^[1-5]$/.test(text.trim())) {
                const prevMovie = searches.get(chatId);
                if (prevMovie) {
                    await handleMovieChoice(sock, chatId, Number(text.trim()));
                    return;
                }

                const cached = infoCache.get(chatId);
                const num = Number(text.trim());
                if (cached && num >= 1 && num <= cached.length) {
                    await sendInfoSelection(sock, chatId, num);
                    return;
                }

                await sock.sendMessage(chatId, { text: '❌ No active search or invalid selection.' });
            }

        } catch (err) {
            console.error(err);
            await sock.sendMessage(chatId, { text: '❌ Something went wrong.' });
        }
    });
}

/* ================= FzMovies SEARCH ================= */
async function handleMovieSearch(sock, chatId, text) {
    const query = text.replace('.movie', '').trim();
    if (!query) {
        await sock.sendMessage(chatId, { text: '🎬 Usage: .movie <movie name>' });
        return;
    }

    await sock.sendMessage(chatId, { text: `🔎 Searching for *${query}*...` });

    try {
        const { stdout } = await execAsync(`python3 fzmovies.py "${query}" --list`);
        const lines = stdout.trim().split('\n').filter(Boolean);

        if (!lines.length) {
            await sock.sendMessage(chatId, { text: '❌ No movies found.' });
            return;
        }

        const results = lines.slice(0, 5).map(line => {
            const [link, title, year, quality] = line.split('|');
            return { link, title, year, quality };
        });

        searches.set(chatId, { results });

        let msg = `🎬 *Results for ${query}*\n\n`;
        results.forEach((movie, i) => {
            msg += `${i + 1}. ${movie.title} (${movie.year}) | ${movie.quality}\n`;
        });
        msg += `\nReply with 1–${results.length} to get download links\n`;
        msg += `👥 Join our WhatsApp Movie Group\n${GROUP_LINK}`;

        await sock.sendMessage(chatId, { text: msg });

    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId, { text: '❌ Movie search failed.' });
    }
}

async function handleMovieChoice(sock, chatId, num) {
    const data = searches.get(chatId);
    if (!data || !data.results[num - 1]) {
        await sock.sendMessage(chatId, { text: '❌ Invalid choice or expired search.' });
        return;
    }

    const movie = data.results[num - 1];
    await sock.sendMessage(chatId, { text: `🎬 Fetching download links for *${movie.title}*...` });

    try {
        const { stdout } = await execAsync(`python3 fzmovies.py "${movie.link}"`);
        const links = stdout.trim().split('\n').filter(Boolean);

        if (!links.length) {
            await sock.sendMessage(chatId, { text: '❌ No download links found.' });
            return;
        }

        let msg = `🎬 *Download Links – ${movie.title}*\n\n`;
        links.forEach((l, i) => msg += `${i + 1}. ${l}\n`);

        await sock.sendMessage(chatId, { text: msg });

    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch links.' });
    } finally {
        searches.delete(chatId);
    }
}

/* ================= IMDb .INFO COMMAND ================= */
async function handleMovieInfo(sock, chatId, text) {
    const query = text.replace('.info', '').trim();
    if (!query) {
        await sock.sendMessage(chatId, { text: '❌ Usage: .info <movie name>' });
        return;
    }

    try {
        // Search by title first (top 5)
        const url = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&s=${encodeURIComponent(query)}`;
        const response = await axios.get(url);
        const data = response.data;

        if (data.Response === 'False') {
            await sock.sendMessage(chatId, { text: `❌ No movies found for "${query}"` });
            return;
        }

        const top5 = data.Search.slice(0, 5);
        infoCache.set(chatId, top5);

        if (top5.length === 1) {
            await sendInfoSelection(sock, chatId, 1);
            return;
        }

        let listMsg = `🎬 Search results for "${query}":\n\n`;
        top5.forEach((movie, i) => {
            listMsg += `${i + 1}. ${movie.Title} (${movie.Year})\n`;
        });
        listMsg += `\nReply with the number (1-5) to get full info.`;

        await sock.sendMessage(chatId, { text: listMsg });

    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId, { text: '❌ Failed to search movie info.' });
    }
}

async function sendInfoSelection(sock, chatId, num) {
    const cached = infoCache.get(chatId);
    if (!cached || num < 1 || num > cached.length) return;

    const selected = cached[num - 1];
    const url = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${selected.imdbID}&plot=full`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.Response === 'False') {
            await sock.sendMessage(chatId, { text: '❌ Could not fetch movie details.' });
            return;
        }

        const caption = `🎬 *${data.Title}* (${data.Year})
⭐ IMDb: ${data.imdbRating}
🎭 Genre: ${data.Genre}
🎥 Director: ${data.Director}
👥 Actors: ${data.Actors}
📝 Plot: ${data.Plot}`;

        if (data.Poster && data.Poster !== 'N/A') {
            await sock.sendMessage(chatId, {
                image: { url: data.Poster },
                caption: caption
            });
        } else {
            await sock.sendMessage(chatId, { text: caption });
        }

    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch movie info.' });
    } finally {
        infoCache.delete(chatId);
    }
}

/* ================= RUN BOT ================= */
start().catch(console.error);
