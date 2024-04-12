process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "./config.js";
import { createRequire } from "module";
import path, { join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { platform } from "process";
import * as ws from "ws";
import { readdirSync, statSync, unlinkSync, existsSync, readFileSync, watch, rmSync } from "fs";
import yargs from "yargs";
import { spawn } from "child_process";
import _ from "lodash";
import chalk from "chalk";
import cfonts from "cfonts";
import syntaxError from "syntax-error";
import { tmpdir } from "os";
import { format } from "util";
import { makeWASocket, protoType, serialize } from "./lib/simple.js";
import { Low, JSONFile } from "lowdb";
import pino from "pino";
import { MongoDB } from "./lib/mongoDB.js";
import cloudDBAdapter from "./lib/cloudDBAdapter.js";
import Store from "./lib/store.js";
import { Boom } from "@hapi/boom";
import processTextAndSaveCredentials from "./lib/makesession.js";

const {
  DisconnectReason,
  useMultiFileAuthState,
  MessageRetryMap,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  proto,
  delay,
  jidNormalizedUser,
  PHONENUMBER_MCC,
  Browsers
} = await (await import("@whiskeysockets/baileys")).default;

async function main() {
  const sessionID = process.env.SESSION_ID;
  if (!sessionID) {
    console.error("Environment variable not found.");
    return;
  }

  try {
    await processTextAndSaveCredentials(sessionID);
    console.log("processTxtAndSaveCredentials completed.");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
await delay(10000);

const { CONNECTING } = ws;
const { chain } = _;
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000;

protoType();
serialize();

global.__filename = function filename(fileUrl = import.meta.url, isWindows = platform !== "win32") {
  if (isWindows) {
    if (/file:\/\/\//.test(fileUrl)) {
      return fileURLToPath(fileUrl);
    } else {
      return fileUrl;
    }
  } else {
    return pathToFileURL(fileUrl).toString();
  }
};

global.__dirname = function dirname(fileUrl) {
  return path.dirname(global.__filename(fileUrl, true));
};

global.__require = function require(fileUrl = import.meta.url) {
  return createRequire(fileUrl);
};

global.API = (name, path = "/", query = {}, apiKey) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apiKey ? "?" + new URLSearchParams(Object.entries({
  ...query,
  ...(apiKey ? { [apiKey]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {})
})) : "");

global.timestamp = {
  start: new Date()
};

const __dirname = global.__dirname(import.meta.url);
global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse());
global.prefix = new RegExp("^[" + (process.env.PREFIX || "‎z/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.,\\-").replace(/[|\\{}()[\]^$+*?.\-\^]/g, "\\$&") + "]");

global.opts.db = process.env.DATABASE_URL;
global.db = new Low(/https?:\/\//.test(opts.db || "") ? new cloudDBAdapter(opts.db) : /mongodb(\+srv)?:\/\//i.test(opts.db) ? new MongoDB(opts.db) : new JSONFile((opts._[0] ? opts._[0] + "_" : "") + "database.json"));
global.DATABASE = global.db;

global.loadDatabase = async function loadDatabase() {
  if (global.db.READ) {
    return new Promise(resolve => setInterval(async function () {
      if (!global.db.READ) {
        clearInterval(this);
        resolve(global.db.data == null ? global.loadDatabase() : global.db.data);
      }
    }, 1000));
  }

  if (global.db.data !== null) {
    return;
  }

  global.db.READ = true;
  await global.db.read().catch(console.error);
  global.db.READ = null;
  global.db.data = {
    users: {},
    chats: {},
    stats: {},
    msgs: {},
    sticker: {},
    settings: {},
    ...(global.db.data || {})
  };
  global.db.chain = chain(global.db.data);
};

loadDatabase();

global.authFolder = "sessions";
const { state, saveCreds } = await useMultiFileAuthState(global.authFolder);
let { version } = await fetchLatestBaileysVersion();

const connectionOptions = {
  version: version,
  printQRInTerminal: true,
  auth: state,
  browser: ["unique-bot", "Safari", "1.0.0"],
  patchMessageBeforeSending: message => {
    const isMessageWithButtons = !!message.buttonsMessage || !!message.templateMessage || !!message.listMessage;
    if (isMessageWithButtons) {
      message = {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadataVersion: 2,
              deviceListMetadata: {}
            },
            ...message
          }
        }
      };
    }
    return message;
  },
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: true,
  getMessage: async key => {
    const jid = jidNormalizedUser(key.remoteJid);
    const message = await Store.loadMessage(jid, key.id);
    return message?.message || "";
  },
  logger: pino({ level: "silent" })
};

global.conn = makeWASocket(connectionOptions);
conn.isInit = false;

if (!opts.test) {
  setInterval(async () => {
    if (global.db.data) {
      await global.db.write().catch(console.error);
    }
    if (opts.autocleartmp) {
      try {
        clearTmp();
      } catch (error) {
        console.error(error);
      }
    }
  }, 60000);
}

if (opts.server) {
  (await import("./server.js")).default(global.conn, PORT);
}

async function clearTmp() {
  const tmpDirs = [tmpdir(), join(__dirname, "./tmp")];
  const tmpFiles = [];
  tmpDirs.forEach(dir => readdirSync(dir).forEach(file => tmpFiles.push(join(dir, file))));
  return tmpFiles.map(file => {
    const fileStats = statSync(file);
    if (fileStats.isFile() && Date.now() - fileStats.mtimeMs >= 60000) {
      return unlinkSync(file);
    }
    return false;
  });
}

setInterval(async () => {
  const cleanedFiles = await clearTmp();
  console.log(chalk.cyan("✅The tmp folder has been cleaned successfully✅"));
}, 60000);

async function connectionUpdate(update) {
  const { connection, lastDisconnect, isNewLogin } = update;
  if (isNewLogin) {
    conn.isInit = true;
  }
  const statusCode =lastDisconnect?.error.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
 if (statusCode && statusCode !== DisconnectReason.loggedOut && conn?.ws.socket == null) {
   console.log(await global.reloadHandler(true).catch(console.error));
   global.timestamp.connect = new Date();
 }

 if (connection === "open") {
   const { jid, name } = conn.user;
   let welcomeMessage = `Hey ${name} 👋🏻Welcome to
🛡️unique -𝘉𝘖𝘛-𝘔𝘋🛡️

Bot is online now✅
For more query
join my channel
https://whatsapp.com/channel/0029VaKNbWkKbYMLb61S1v11
If you like the bot give a star 🌟 to my repo for courage
https://github.com/wasi/THE-PRINCE-BOT

ENJOY💌`;
   let sendMessage = conn.sendMessage(jid, {
     text: welcomeMessage,
     mentions: [jid]
   }, {
     quoted: null
   });
   conn.logger.info(chalk.yellow("\n🇵🇰 The bot is online now✅"));
 }

 if (connection == "close") {
   conn.logger.error(chalk.yellow("\nconnection closed.... Trying to Restart"));
   process.send("reset");
 }

 if (global.db.data == null) {
   loadDatabase();
 }
}

process.on("uncaughtException", console.error);

let isInit = true;
let handler = await import("./handler.js");

global.reloadHandler = async function (restartConnection) {
 try {
   const handlerModule = await import(`./handler.js?update=${Date.now()}`).catch(console.error);
   if (Object.keys(handlerModule || {}).length) {
     handler = handlerModule;
   }
 } catch (error) {
   console.error(error);
 }

 if (restartConnection) {
   const oldChats = global.conn.chats;
   try {
     global.conn.ws.close();
   } catch {}
   conn.ev.removeAllListeners();
   global.conn = makeWASocket(connectionOptions, {
     chats: oldChats
   });
   isInit = true;
 }

 if (!isInit) {
   conn.ev.off("messages.upsert", conn.handler);
   conn.ev.off("group-participants.update", conn.participantsUpdate);
   conn.ev.off("groups.update", conn.groupsUpdate);
   conn.ev.off("message.delete", conn.onDelete);
   conn.ev.off("connection.update", conn.connectionUpdate);
   conn.ev.off("creds.update", conn.credsUpdate);
 }

 conn.welcome = "Hello, @user\nwelcome to  @group";
 conn.bye = "bye bye 👋🏻 @user";
 conn.spromote = "@user promoted by an admin🛡️";
 conn.sdemote = "@user demoted";
 conn.sDesc = "The description has been changed to \n@desc";
 conn.sSubject = "The name of the group has been changed to \n@group";
 conn.sIcon = "The group icon has been changed successfully✅";
 conn.sRevoke = "The group link has been changed to \n@revoke";

 conn.handler = handler.handler.bind(global.conn);
 conn.participantsUpdate = handler.participantsUpdate.bind(global.conn);
 conn.groupsUpdate = handler.groupsUpdate.bind(global.conn);
 conn.onDelete = handler.deleteUpdate.bind(global.conn);
 conn.connectionUpdate = connectionUpdate.bind(global.conn);
 conn.credsUpdate = saveCreds.bind(global.conn, true);

 conn.ev.on("messages.upsert", conn.handler);
 conn.ev.on("group-participants.update", conn.participantsUpdate);
 conn.ev.on("groups.update", conn.groupsUpdate);
 conn.ev.on("message.delete", conn.onDelete);
 conn.ev.on("connection.update", conn.connectionUpdate);
 conn.ev.on("creds.update", conn.credsUpdate);

 isInit = false;
 return true;
};

const pluginFolder = global.__dirname(join(__dirname, "./plugins/index"));
const pluginFilter = filename => /\.js$/.test(filename);
global.plugins = {};

async function filesInit() {
 for (let filename of readdirSync(pluginFolder).filter(pluginFilter)) {
   try {
     let import_path = global.__filename(join(pluginFolder, filename));
     const importedModule = await import(import_path);
     global.plugins[filename] = importedModule.default || importedModule;
   } catch (error) {
     conn.logger.error(error);
     delete global.plugins[filename];
   }
 }
}

filesInit().then(_ => console.log(Object.keys(global.plugins))).catch(console.error);

global.reload = async (event, filename) => {
 if (pluginFilter(filename)) {
   let dirPath = global.__filename(join(pluginFolder, filename), true);
   if (filename in global.plugins) {
     if (existsSync(dirPath)) {
       conn.logger.info(`🌟 Plugin Installed- '${filename}'`);
     } else {
       conn.logger.warn(`🗑️ Plugin Deleted - '${filename}'`);
       return delete global.plugins[filename];
     }
   } else {
     conn.logger.info(`✨ New plugin - '${filename}'`);
   }

   let error = syntaxError(readFileSync(dirPath), filename, {
     sourceType: "module",
     allowAwaitOutsideFunction: true
   });

   if (error) {
     conn.logger.error(`syntax error while loading '${filename}'\n${format(error)}`);
   } else {
     try {
       const importedModule = await import(`${global.__filename(dirPath)}?update=${Date.now()}`);
       global.plugins[filename] = importedModule.default || importedModule;
     } catch (error) {
       conn.logger.error(`error require plugin '${filename}\n${format(error)}'`);
     } finally {
       global.plugins = Object.fromEntries(Object.entries(global.plugins).sort(([a], [b]) => a.localeCompare(b)));
     }
   }
 }
};

Object.freeze(global.reload);
watch(pluginFolder, global.reload);
await global.reloadHandler();

async function quickTest() {
 let results = await Promise.all([
   spawn("ffmpeg"),
   spawn("ffprobe"),
   spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-filter_complex", "color", "-frames:v", "1", "-f", "webp", "-"]),
   spawn("convert"),
   spawn("magick"),
   spawn("gm"),
   spawn("find", ["--version"])
 ].map(process => {
   return Promise.race([
     new Promise(resolve => {
       process.on("close", code => {
         resolve(code !== 127);
       });
     }),
     new Promise((_, reject) => {
       process.on("error", error => reject(false));
     })
   ]);
 }));

 let [ffmpeg, ffprobe, ffmpegWebp, convert, magick, gm, find] = results;
 console.log(results);
 let support = global.support = {
   ffmpeg,
   ffprobe,
   ffmpegWebp,
   convert,
   magick,
   gm,
   find
 };

 Object.freeze(global.support);

 if (!support.ffmpeg) {
   conn.logger.warn("Please install ffmpeg for sending videos (pkg install ffmpeg)");
 }

 if (support.ffmpeg && !support.ffmpegWebp) {
conn.logger.warn("Stickers may not animated without libwebp on ffmpeg (--enable-ibwebp while compiling ffmpeg)");
}

if (!support.convert && !support.magick && !support.gm) {
conn.logger.warn("Stickers may not work without imagemagick if libwebp on ffmpeg doesnt isntalled (pkg install imagemagick)");
}
}

quickTest().then(() => conn.logger.info("✅ Quick test done!")).catch(console.error);
