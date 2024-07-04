import {
    clearHighlightInterval,
    createHighlightInterval,
    error,
    fromPage,
    fromPageId,
    getChunk,
    getChunkRoot,
    notice,
    randomFill,
    teleport,
} from './helper.js';
import {
    BOOKSHELF_COORDINATES,
    BOOKSHELF_COORDINATES_MAP,
    CHARACTERS,
    COORDINATE_KEYS,
    NEARBY_SEARCH_TOOL_URL,
    NUM_INVENTORY_SLOTS,
    STRING_LENGTH,
} from './constants.js';
import {packets} from './packets.js';
import {CONFIG} from './config.js';
import * as https from 'https';
import {admins} from './firebase.js';
import {emojiFormat} from './emojiFormat.js';
import {decrypt} from './encryption.js';

/*
 * Converts Minecraft coordinate format (including `~`) into absolute world coordinates.
 */
function parseCoordinates(client, parameters, errorClient) {
    const coordinates = Object.fromEntries(parameters
        .map(coordinate => coordinate.replace(/,/g, ''))
        .map((coordinate, index) => coordinate.startsWith('~')
            ? (parseFloat(coordinate.slice(1)) || 0) + client.__state.position[COORDINATE_KEYS[index]]
            : coordinate)
        .map((coordinate, index) => [COORDINATE_KEYS[index], parseFloat(coordinate)]));

    if (Object.values(coordinates).some(isNaN)) {
        error(errorClient ?? client, 'Coordinate Invalide.');
        return;
    }

    return coordinates;
}

/*
 * Send a report message to the Discord webhook path specified in the config.
 */
function makeReportRequest(client, username, text) {
    const request = https.request({
        hostname: 'discord.com',
        port: 443,
        path: CONFIG.reportPath,
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
    }, result => {
        if (!result.statusCode.toString().startsWith('2')) error(client, 'Errore nel reporting dell \' utente. Riprova più tardi.');
        packets.chat(client, emojiFormat(`${username} è stato reportato, thank you.`));
    });

    request.on('error', () => error(client, 'Errore nel reporting dell \' utente. rirpova più tardi.'));
    request.write(`{"content": "${text}"}`);
    request.end();
}

export const commands = {
    help(server, client) {
        packets.chat(client, emojiFormat(
            '🟪➕=== Newexpirence Fallback server - Comandi ===\n' +
            '⬜➖/tp 🟨<username> ⬜| (🟨<x> <y> <z> ⬜[🟨<yaw> <pitch>⬜])\n' +
            '    ⬛✖Teletrasporta un player alle cordinate.\n' +
            '⬜➗/search (🟨"exact" ⬜| 🟨"fill"⬜) 🟨<text>\n' +
            '    ⬛✖Cerca per testo specifico.\n' +
            '⬜➗/highlight (🟨<shelf> ⬜[🟨<nearX> <nearY> <nearZ>⬜]) | 🟨"stop"\n' +
            '    ⬛✖Evidenzia una libreria alle cordinate specifiche.\n' +
            '⬜➗/togglechat\n' +
            '    ⬛✖Attiva/disattiva la chat.\n' +
            '⬜➗/toggleplayers\n' +
            '    ⬛✖Attiva/Disattiva la visibilità dei player.\n' +
            '⬜➗/report 🟨<username> ⬜[🟨<reason>⬜]\n' +
            '    ⬛✖Reporta un giocatore per abuso.\n' +
            '⬜➗/clear\n' +
            '    ⬛✖Cancella tutti gli oggetti dall\' inventario.',
        ));
        if (admins.has(client.uuid)) {
            packets.chat(client, emojiFormat(
                '🟪➕=== Comandi Admin ===\n' +
                '⬜➖/kick 🟨<username> ⬜[🟨<reason>⬜]\n' +
                '    ⬛✖Kicka un player.\n' +
                '⬜➗/tpother 🟨<username> </tp parameters>\n' +
                '    ⬛✖Teletrasporta un altro giocatore.\n' +
                '⬜➗/announce 🟨<message>\n' +
                '    ⬛✖Fai un annuncio in chat.\n' +
                '⬜➗/tell 🟨<username> <message>\n' +
                '    ⬛✖Invia un messaggio diretto al player.',
            ));
        }
    },
    tp(server, client, parameters, errorClient) {
        errorClient = errorClient ?? client;
        if (parameters.length === 1) {
            const [username] = parameters;
            if (username === client.username) {
                error(errorClient, 'Non puoi teletrasportarti.');
                return;
            }
            const otherClient = Object.values(server.clients).find(client => client.username === username);
            if (otherClient === undefined) {
                error(errorClient, 'Quel giocatore non è online.');
                return;
            }
            console.log(`${client.username} è stato teletrasportato a ${otherClient.username}.`);
            teleport(client, otherClient.__state.position);
        } else if (parameters.length === 3 || parameters.length === 5) {
            const coordinates = parseCoordinates(client, parameters, errorClient);
            if (coordinates === undefined) return;
            console.log(`${client.username} teletrasportato a ${Object.values(coordinates).join(', ')}.`);
            teleport(client, {yaw: 0, pitch: 0, ...coordinates});
        } else {
            error(errorClient, 'Questo comando richiede più parametri.');
        }
    },
    search(server, client, parameters) {
        const [searchMode, ...rest] = parameters;
        let searchQuery = rest.join(' ').toUpperCase();
        if (searchQuery.length > STRING_LENGTH) {
            error(client, `Le frasi non possono essere più lunghe di ${STRING_LENGTH} caratteri.`);
            return;
        }
        if (Array.from(searchQuery).every(character => character === ' ')) {
            notice(client, 'Il testo che hai inviato era vuoto.');
        }
        if (searchMode === 'fill') {
            const filledSearchQuery = randomFill(searchQuery);
            console.log(`${client.username} cercato la frase:  "${searchQuery}" ("${filledSearchQuery}").`);
            searchQuery = filledSearchQuery
        }
        else if (searchMode !== 'exact') {
            error(client, 'Search mode deve essere "fill" o "exact".');
            return;
        } else {
            console.log(`${client.username} ha cercato per "${searchQuery}".`);
        }
        if (Array.from(searchQuery).some(character => !CHARACTERS.includes(character))) {
            error(client, 'Solo lettere e spazi sono ammessi.');
            return;
        }
        if (searchQuery.length < STRING_LENGTH) searchQuery = searchQuery.padEnd(STRING_LENGTH, ' ');
        const {x, y, z, shelf, shulker, book, page} = fromPageId(fromPage(decrypt(searchQuery)));
        const [shelfX, shelfY, shelfZ] = BOOKSHELF_COORDINATES[shelf].split(' ').map(coordinate => parseInt(coordinate));
        const tpCoordinates = Object.values(BOOKSHELF_COORDINATES_MAP)[shelf];
        const [formattedX, formattedY, formattedZ] = [x + shelfX, y + shelfY, z + shelfZ]
            .map(coordinate => Math.abs(coordinate) > 999999 ? coordinate.toLocaleString('en-US') : coordinate);
        packets.chat(client, [
            ...emojiFormat(
                '🟪➕=== Risultati ricerca  ===\n' +
                `⬜➖Quel testo è stato ritrovato a  🟥➕x=${formattedX} y=${formattedY} z=${formattedZ}⬜➖.\n` +
                `Nella 🟨➕shelf ${shelf + 1n}⬜➖, 🟩➕shulker ${shulker + 1n}⬜➖, 🟦➕libro ${book + 1n}⬜➖, 🟪➕pagina ${page + 1n}⬜➖.\n\n` +
                `azioni: 🟦`,
            ),
            {color: 'aqua', text: '[Teletrasportati vicino]', clickEvent: {action: 'run_command', value:`/tp ${x + tpCoordinates.x} ${y + tpCoordinates.y} ${z + tpCoordinates.z} ${tpCoordinates.yaw} ${tpCoordinates.pitch}`}},
            {color: 'white', text: ' '},
            {color: 'aqua', text: '[Evidenzia una shelf]', clickEvent: {action: 'run_command', value:`/highlight ${shelf + 1n} ${x} ${y} ${z}`}},
            ...(searchMode === 'fill' ? [
                {color: 'white', text: ' '},
                {color: 'aqua', text: '[Trova prossimo]', clickEvent: {action: 'run_command', value:`/search fill ${rest.join(' ')}`}},
            ] : []),
        ]);
    },
    nearbysearch(server, client) {
        const {x, y, z} = client.__state.position;
        const query = `?x=${Math.floor(x)}&y=${Math.floor(y)}&z=${Math.floor(z)}`;
        packets.chat(client, [
            ...emojiFormat('Nearby search tool: '),
            {color: 'aqua', text: NEARBY_SEARCH_TOOL_URL, clickEvent: {action: 'open_url', value: NEARBY_SEARCH_TOOL_URL + query}},
        ]);
    },
    highlight(server, client, parameters) {
        let position;
        if (parameters.length === 1) {
            if (parameters[0] === 'stop') {
                packets.chat(client, emojiFormat('L\' evidenziamento è stato fermato.'))
                clearHighlightInterval(client);
                return;
            }

            position = client.__state.position;
        } else if (parameters.length === 4) {
            position = parseCoordinates(client, parameters.slice(1));
            if (position === undefined) return;
        }
        else {
            error(client, 'Questo comando richiede più parametri.');
            return;
        }

        const shelf = parseInt(parameters[0]) - 1;

        if (isNaN(shelf) || shelf < 0 || shelf >= BOOKSHELF_COORDINATES.length) {
            error(client, `Shelf deve essere tra 1 e ${BOOKSHELF_COORDINATES.length} (inclusive).`);
            return;
        }

        const {x, y, z} = getChunkRoot(getChunk(position));
        const coordinates = createHighlightInterval(client, x, y, z, shelf).map(Math.floor);

        console.log(`${client.username} is highlighting shelf ${parameters[0]} at ${coordinates.join(', ')}.`);
        packets.chat(client, [
            ...emojiFormat(`🟨➕Shelf ${parameters[0]} ⬜➖(🟥➕${coordinates.join(', ')}⬜➖) highlighted.\nRun `),
            {color: 'aqua', text: '[/highlight stop]', clickEvent: {action: 'suggest_command', value:'/highlight stop'}},
            {color: 'white', text: ' per fermare l\'evidenziamento.'},
        ]);
    },
    togglechat(server, client) {
        client.__state.chat = !client.__state.chat;
        const onOff = client.__state.chat ? 'ON' : 'OFF';
        console.log(`${client.username} ha impostato la chat su: ${onOff}.`);
        packets.chat(client, emojiFormat(`La chat è stata impostata a:  🟪➕${onOff}⬜➖.`));
        if (client.__state.chat) notice(client, 'Per favore sii rispettoso. L\' abuso non sarà tollerato.');
    },
    toggleplayers(server, client) {
        if (client.__state.players) {
            client.__state.nearbyClients.forEach(id => {
                packets.destroyPlayer(client, id);
                client.__state.nearbyClients.delete(id);
            });
        }
        client.__state.players = !client.__state.players;
        const onOff = client.__state.players ? 'ON' : 'OFF';
        console.log(`${client.username} has toggled chat ${onOff}.`);
        packets.chat(client, emojiFormat(`La visibilità dei giocatori è stato impostata a:  🟪➕${onOff}⬜➖.`));
    },
    report(server, client, parameters) {
        if (!CONFIG.reportPath) {
            error(client, 'Il reporting non è abilitato su questo server.');
            return;
        }

        if (parameters.length < 1) {
            error(client, 'Questo comando richiede più parametri.');
            return;
        }

        const [username, ...reason] = parameters;
        const otherClient = Object.values(server.clients).find(otherClient => otherClient.username === username);
        if (!otherClient) notice(client, 'Quel giocatore non è online ma verrà reportato lo stesso.');

        console.log(`${client.username} ha reportato ${username} per "${reason.join(' ')}".`);

        makeReportRequest(
        client,
        username,
        `**${client.username}** ha reportato **${username}**${otherClient ? ` (${otherClient.uuid})` : ''} per "${reason.join(' ')}".\n\n` +
            `${otherClient ? `I messaggi recenti di **${username}**:\n${otherClient.__state.recentChats.map(chat => `- "${chat}"`).join('\n')}` : ''}`
    );
    },
    clear(server, client) {
        for (let slot = 0; slot <= NUM_INVENTORY_SLOTS; ++slot) packets.clearSlot(client, slot);
        packets.chat(client, emojiFormat(`Il tuo inventario è stato cancellato.`));
        console.log(`${client.username} ha cancellato il suo inventario.`);
    },

    // Below are admin only commands

    kick(server, client, parameters) {
        if (!admins.has(client.uuid)) {
            error(client, 'Comando invalido. esegui /help per una lista di comandi.');
            return;
        }

        if (parameters.length < 1) {
            error(client, 'Il comando richiede più parametri.');
            return;
        }

        const [username, ...reason] = parameters;
        const otherClient = Object.values(server.clients).find(otherClient => otherClient.username === username);
        if (!otherClient) {
            error(client, 'Quel comando richiede più parametri.');
            return;
        }

        const reasonString = reason.join(' ');
        console.log(`${client.username} ha kickato ${otherClient.username} per la ragione:  "${reasonString}".`);
        otherClient.end('§dSei stato kickado rip.' + (reasonString ? ` Ragione: ${reasonString}.` : ''));
        packets.chat(client, emojiFormat(`${username} è stato kickato.`));
    },
    tpother(server, client, parameters) {
        if (!admins.has(client.uuid)) {
            error(client, 'Comando invalido. Scrivi /help per una lista intera di comandi.');
            return;
        }

        if (parameters.length < 2) {
            error(client, 'Questo comando richiede più parametri');
            return;
        }

        const [username, ...rest] = parameters;
        const otherClient = Object.values(server.clients).find(otherClient => otherClient.username === username);

        console.log(`${client.username} ha usato /tpother su ${otherClient.username}.`);
        this.tp(server, otherClient, rest, client);
    },
    announce(server, client, parameters) {
        if (!admins.has(client.uuid)) {
            error(client, 'Invalid command. Type /help for a list of commands.');
            return;
        }

        if (parameters.length < 1) {
            error(client, 'Quel comando richiede più parametri.');
            return;
        }

        const message = parameters.join(' ');
        console.log(`${client.username} announced: "${message}".`);
        packets.chat(client, emojiFormat(`🟥➕[ANNUNCIO] ⬜➖<🟪${client.username}⬜> ${message}`));
    },
    tell(server, client, parameters) {
        if (!admins.has(client.uuid)) {
            error(client, 'Invalid command. Type /help for a list of commands.');
            return;
        }

        if (parameters.length < 2) {
            error(client, 'Quel comando richiede più parametri.');
            return;
        }

        const [username, ...rest] = parameters;
        const otherClient = Object.values(server.clients).find(otherClient => otherClient.username === username);
        if (!otherClient) {
            error(client, 'Quel utente non è online.');
            return;
        }
        const message = rest.join(' ');

        packets.chat(otherClient, emojiFormat(`🟥➕[MESSAGGIO DIRETTO] ⬜➖<🟪${client.username}⬜> ${message}`));
        console.log(`${client.username} ha detto a ${otherClient.username} "${message}".`);
    },
};
