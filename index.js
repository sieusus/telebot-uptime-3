console.log('🚀 Starting...');

process.on('unhandledRejection', error => console.log(error));
process.on('uncaughtException', error => console.log(error));

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const mongoose = require("mongoose");
require('dotenv').config();


const TOKEN = process.env.TOKEN;
const SERVER_URL = process.env.URL;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_ID = process.env.ADMIN_ID;
const PORT = process.env.PORT || 3000;


const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const URI = `/webhook/${TOKEN}`;
const WEBHOOK_URL = SERVER_URL + URI;

const prefix = "/";

const UptimeModel = require('./models/uptime.js');

const app = express();
app.use(bodyParser.json());

/**
 * @param {number} chatId id of chat
 * @param {string} text text to send
 */
function sendMessage(chatId, text) {
	axios.post(`${TELEGRAM_API}/sendMessage`, {
		chat_id: chatId,
		text: text
	});
}
/**
 * Connect to MongoDB
 * @param {string} uri
 * @returns {Promise<void>}
 */
async function connectDatabase(url) {
	try {
		await mongoose.connect(url, {
			useNewUrlParser: true,
			useUnifiedTopology: true
		});
		console.log('✅ Connected to database successfully');
	}
	catch (err) {
		console.log(`❌ Error when connect to database:`, err);
	}
}
/**
 * @description Convert seconds to human readable format
 * @param {number} ms milliseconds
 * @returns {string}
 */
function converTime(ms) {
	const hours = Math.floor(ms / 3600000);
	const minutes = Math.floor((ms % 3600000) / 60000);
	const seconds = Math.floor(((ms % 3600000) % 60000) / 1000);
	return `${hours ? hours + 'h ' : ''}${minutes ? minutes + 'm ' : ''}${seconds ? seconds + 's' : ''}`;
}

function sendRequest(url) {
	return axios.get(url)
		.then()
		.catch(() => {
			throw new Error('Error when send request');
		});
}
/**
 * @description Send request to url uptime
 * @param {Object} uptime
 */
function getUptime(uptime) {
	axios.get(uptime.url)
		.then(() => {
			if (global.temp.uptimeFail[uptime.url]) {
				sendMessage(uptime.author, `✅ ${uptime.url} is back online (failed in ${converTime(Date.now() - global.temp.uptimeFail[uptime.url]) || '0s'})`);
				delete global.temp.uptimeFail[uptime.url];
			}
		})
		.catch((err) => {
			if (!global.temp.uptimeFail[uptime.url]) {
				global.temp.uptimeFail[uptime.url] = Date.now();
				sendMessage(uptime.author, `❌ ${uptime.url} is down`);
				console.log(`❌ ${uptime.url} is down`, err);
			}
		});
}

(async () => {
	global.temp = {
		uptimeFail: {},
		idInterval: {}
	};
	const init = async () => {
		const res = await axios.get(`${TELEGRAM_API}/setWebhook?url=${WEBHOOK_URL}`);
		console.log(res.data);
	};

	await connectDatabase(MONGO_URI);
	const uptimes = await UptimeModel.find();
	for (const uptime of uptimes)
		sendRequest(uptime.url)
			.then()
			.catch(() => {
				global.temp.uptimeFail[uptime.url] = Date.now();
				sendMessage(uptime.author, `❌ ${uptime.url} is down`);
			})
			.finally(() => {
				global.temp.idInterval[uptime.url] = setInterval(() => getUptime(uptime), uptime.timeInterval);
			});

	app.get('/', (req, res) => {
		res.send('Hello world!');
	});

	app.post(URI, async (req, res) => {
		res.send();
		const data = req.body;
		const { chat: { id: chatId }, text: content, from: { id: author, first_name, last_name } } = data.message || {};
		if (!chatId || !content)
			return;

		const args = content.split(' ');
		const commandName = args.shift().toLowerCase();
		console.log(`📝 ${author} (${first_name} ${last_name}) sent command: ${commandName}`);
		if (commandName == prefix + 'uptime') {
			switch (args[0]) {
				case 'add': {
					const url = args[1];
					let timeInterval = args[2];
					if (!url)
						return sendMessage(chatId, 'Please input url');
					if (isNaN(timeInterval))
						return sendMessage(chatId, 'Please input time interval in number');
					timeInterval = parseInt(timeInterval * 1000);
					const uptime = await UptimeModel.findOne({ url });
					if (uptime)
						return sendMessage(chatId, 'This url is already in database');
					try {
						const newUptime = new UptimeModel({
							url,
							timeInterval,
							author
						});
						await newUptime.save();
						sendMessage(chatId, `Added ${url} to database successfully, send request every ${converTime(timeInterval)}`);
						sendRequest(url)
							.then()
							.catch((e) => {
								global.temp.uptimeFail[url] = Date.now();
								sendMessage(chatId, `${url} is down`);
							})
							.finally(() => {
								global.temp.idInterval[url] = setInterval(() => getUptime(newUptime), timeInterval);
							});
					}
					catch (err) {
						console.log(err);
						sendMessage(chatId, '❌ Error');
					}
					break;
				}
				case 'list': {
					let uptimes = await UptimeModel.find();
					if (args[1] == 'all') {
						if (author != ADMIN_ID)
							return sendMessage(chatId, '❌ You are not admin');
					}
					else {
						uptimes = uptimes.filter(uptime => uptime.author == author);
					}
					if (!uptimes.length)
						return sendMessage(chatId, 'No uptime in database');
					let i = 1;
					const text = uptimes.map(uptime => `${i++}. Url: ${uptime.url}\n   Time interval: ${converTime(uptime.timeInterval)}\n   Author: ${uptime.author}`).join('\n\n');
					sendMessage(chatId, text);
					break;
				}
				case 'remove':
				case 'delete':
				case 'del':
				case '-d': {
					const url = args.slice(1).join(' ');
					if (!url)
						return sendMessage(chatId, 'Please input url or id');
					let uptime;
					if (!isNaN(url)) {
						const uptimes = await UptimeModel.find({});
						uptime = uptimes[url - 1];
					}
					else {
						uptime = await UptimeModel.findOne({ url });
					}
					if (!uptime)
						return sendMessage(chatId, `No found uptime url with ${isNaN(url) ? 'url' : 'id'} ${url}`);
					if (uptime.author != author)
						return sendMessage(chatId, 'You are not owner of this uptime');
					await UptimeModel.deleteOne({ url: uptime.url });
					clearInterval(global.temp.idInterval[uptime.url]);
					sendMessage(chatId, `Removed ${uptime.url} from database successfully`);
				}
					break;
			}
		}
		else if (commandName == prefix + 'help') {
			sendMessage(chatId, `${prefix}uptime add <url> <time interval>\n${prefix}uptime list <all>\n${prefix}uptime remove <url>\n${prefix}uptime delete <url>\n${prefix}uptime del <url>`);
		}
		else if (commandName == prefix + 'eval') {
			if (author != ADMIN_ID)
				return sendMessage(chatId, '❌ You are not admin');
			try {
				eval(args.join(' '));
			}
			catch (err) {
				sendMessage(chatId, `❌ Error: ${err}`);
			}
		}
	});

	app.listen(PORT, async () => {
		await init();
	});

})();


